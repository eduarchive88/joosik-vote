const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// In-memory 데이터베이스
const rooms = {};

// 헬퍼 함수: 방 코드 생성 (영문 대문자 + 숫자 5자리)
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (rooms[code]);
    return code;
}

// 주가 변동 가중치 설정
const PRICE_IMPACT = {
    VOTE_UP: 100,
    VOTE_DOWN: -100,
    BUY: 50,
    SELL: -50
};
const INITIAL_STOCK_PRICE = 10000;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. 방장(교사) 방 생성
    socket.on('createRoom', ({ numTeams, initialCash, customRoomCode }, callback) => {
        let roomCode = generateRoomCode();
        if (customRoomCode && customRoomCode.trim() !== '') {
            roomCode = customRoomCode.trim().toUpperCase();
            if (rooms[roomCode]) {
                return callback({ success: false, message: '이미 사용 중인 방 코드입니다. 다른 코드를 입력하세요.' });
            }
        }
        
        const teams = {};
        for(let i=1; i<=numTeams; i++) {
            teams[`team${i}`] = {
                id: `team${i}`,
                name: `${i}모둠`,
                price: INITIAL_STOCK_PRICE,
                history: [INITIAL_STOCK_PRICE], // 차트용
                votes: { up: 0, down: 0 }
            };
        }

        rooms[roomCode] = {
            host: socket.id,
            initialCash: parseInt(initialCash),
            teams: teams,
            students: {},
            currentPresentation: null, // 현재 발표 중인 모둠 ID
            // 게임 단계: 'waiting'(대기) | 'presentation'(발표중) | 'trading'(매매중) | 'ended'(종료)
            phase: 'waiting',
            chats: [] // { sender, message, type, teamId, teamName }
        };

        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.role = 'teacher';

        callback({ success: true, roomCode, roomData: rooms[roomCode] });
    });

    // 2. 학생 입장
    socket.on('joinRoom', ({ roomCode, studentId, studentName }, callback) => {
        roomCode = roomCode.toUpperCase();
        const room = rooms[roomCode];

        if (!room) {
            return callback({ success: false, message: '존재하지 않는 방 코드입니다.' });
        }

        // 5자리 숫자 학번 검증
        if (!/^\d{5}$/.test(studentId)) {
            return callback({ success: false, message: '학번은 하이픈(-) 없이 5자리 숫자로 입력해야 합니다.' });
        }

        // 중복 학번 체크 (재접속 허용 로직)
        let existingSocketId = null;
        for (let sid in room.students) {
            if (room.students[sid].studentId === studentId) {
                existingSocketId = sid;
                break;
            }
        }

        if (existingSocketId) {
            // 기존 데이터 백업 후 새로운 socket id로 이동 (새로고침/재접속 대응)
            const oldData = room.students[existingSocketId];
            oldData.socketId = socket.id;
            oldData.studentName = studentName;
            room.students[socket.id] = oldData;
            delete room.students[existingSocketId];
            
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.role = 'student';

            io.to(room.host).emit('studentJoined', room.students[socket.id]);
            return callback({ success: true, roomData: room, studentData: room.students[socket.id] });
        }

        // 초기 포트폴리오 세팅 (모든 모둠 주식 1주씩)
        const initialPortfolio = {};
        for (let tId in room.teams) {
            initialPortfolio[tId] = 1;
        }

        room.students[socket.id] = {
            socketId: socket.id,
            studentId,
            studentName,
            cash: room.initialCash,
            portfolio: initialPortfolio,
            votes: {}, // teamId: 'up' or 'down'
            lastVoteTime: 0
        };

        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.role = 'student';

        // 교사에게 학생 입장 알림
        io.to(room.host).emit('studentJoined', room.students[socket.id]);
        
        callback({ success: true, roomData: room, studentData: room.students[socket.id] });
    });

    // 3. 교사: 발표 제어 (시작/종료)
    socket.on('setPresentation', ({ roomCode, teamId, status }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        if (status === 'start') {
            room.currentPresentation = teamId;
            room.phase = 'presentation';
        } else if (status === 'end') {
            room.currentPresentation = null;
            room.phase = 'waiting';
        }

        io.to(roomCode).emit('presentationStatusChanged', {
            teamId,
            status,
            phase: room.phase
        });
    });

    // 4. 교사: 게임 단계 전환 (매매 시작 / 매매 종료)
    socket.on('setPhase', ({ roomCode, phase }, callback) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        // 매매 시작 전에 발표 중이면 발표 종료
        if (phase === 'trading') {
            room.currentPresentation = null;
        }
        room.phase = phase;

        io.to(roomCode).emit('phaseChanged', { phase });
        if (callback) callback({ success: true });
    });

    // 5. 학생: 실시간 투표 (발표 중에만 허용)
    socket.on('vote', ({ roomCode, teamId, type, reason }) => {
        const room = rooms[roomCode];
        // 발표 중이며 해당 모둠이 발표 중일 때만 허용
        if (!room || room.phase !== 'presentation' || room.currentPresentation !== teamId) return;
        
        const student = room.students[socket.id];
        if (!student) return;

        // 쿨타임 체크 (5초)
        const now = Date.now();
        if (now - student.lastVoteTime < 5000) {
            socket.emit('voteError', { message: '투표 쿨타임 중입니다. 잠시 후 다시 시도하세요.' });
            return;
        }

        student.lastVoteTime = now;
        student.votes[teamId] = type;

        const team = room.teams[teamId];
        if (type === 'up') {
            team.votes.up++;
            team.price += PRICE_IMPACT.VOTE_UP;
        } else if (type === 'down') {
            team.votes.down++;
            team.price += PRICE_IMPACT.VOTE_DOWN;
        }

        // 주가 0원 이하 방지
        if (team.price < 0) team.price = 0;
        
        team.history.push(team.price);

        // 이유가 있으면 채팅으로 전송 (모둠 정보 포함)
        if (reason && reason.trim() !== '') {
            const chatMsg = {
                sender: `${student.studentId} ${student.studentName}`,
                message: reason,
                type: type,
                teamId: teamId,
                teamName: team.name
            };
            room.chats.push(chatMsg);
            io.to(roomCode).emit('newChat', chatMsg);
        }

        // 모든 방 인원에게 가격 업데이트 알림
        io.to(roomCode).emit('priceUpdated', { teamId, price: team.price, history: team.history, votes: team.votes });
    });

    // 6. 학생: 채팅 (발표 중에만 허용, 모둠 정보 포함)
    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        // 발표 중이 아니면 채팅 불가
        if (room.phase !== 'presentation') return;

        const student = room.students[socket.id];
        if (!student) return;

        const presentingTeam = room.currentPresentation ? room.teams[room.currentPresentation] : null;
        const chatMsg = {
            sender: `${student.studentId} ${student.studentName}`,
            message: message,
            type: 'neutral',
            teamId: room.currentPresentation || null,
            teamName: presentingTeam ? presentingTeam.name : null
        };
        room.chats.push(chatMsg);
        io.to(roomCode).emit('newChat', chatMsg);
    });

    // 7. 학생: 주식 매수/매도 (매매 단계에만 허용)
    socket.on('trade', ({ roomCode, teamId, action, amount }, callback) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        // 매매 단계가 아닐 때는 거래 불가
        if (room.phase !== 'trading') {
            return callback({ success: false, message: '현재 매매 단계가 아닙니다. 교사의 매매 시작 안내를 기다려주세요.' });
        }

        const student = room.students[socket.id];
        const team = room.teams[teamId];
        if (!student || !team) return;

        const qty = parseInt(amount);
        if (isNaN(qty) || qty <= 0) return;

        let cost = team.price * qty;
        
        if (action === 'buy') {
            if (student.cash < cost) {
                return callback({ success: false, message: '현금이 부족합니다.' });
            }
            student.cash -= cost;
            student.portfolio[teamId] += qty;
            team.price += PRICE_IMPACT.BUY * qty;
        } else if (action === 'sell') {
            if (student.portfolio[teamId] < qty) {
                return callback({ success: false, message: '보유 주식이 부족합니다.' });
            }
            student.cash += cost;
            student.portfolio[teamId] -= qty;
            team.price += PRICE_IMPACT.SELL * qty;
        } else {
            return callback({ success: false, message: '잘못된 거래 요청입니다.' });
        }

        // 주가 0원 이하 방지
        if (team.price < 0) team.price = 0;
        team.history.push(team.price);

        // 업데이트 된 가격 방송
        io.to(roomCode).emit('priceUpdated', { teamId, price: team.price, history: team.history, votes: team.votes });
        
        // 학생 본인에게 거래 완료 및 자산 업데이트 응답
        callback({ success: true, cash: student.cash, portfolio: student.portfolio });
    });

    // 8. 교사 방의 현재 상태 요청
    socket.on('requestRoomState', (roomCode, callback) => {
        const room = rooms[roomCode];
        if(room) {
            callback({ success: true, roomData: room });
        } else {
            callback({ success: false });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (socket.roomCode) {
            const room = rooms[socket.roomCode];
            if (room) {
                if (room.host === socket.id) {
                    // 방장이 나가도 방은 유지 (학생 데이터 보존)
                } else if (room.students[socket.id]) {
                    io.to(room.host).emit('studentLeft', socket.id);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
