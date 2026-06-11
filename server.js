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
    socket.on('createRoom', ({ numTeams, initialCash }, callback) => {
        const roomCode = generateRoomCode();
        
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
            chats: [] // { sender, message, teamId }
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

        // 중복 학번 체크
        for (let sid in room.students) {
            if (room.students[sid].studentId === studentId) {
                return callback({ success: false, message: '이미 접속 중인 학번입니다.' });
            }
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
        } else if (status === 'end') {
            room.currentPresentation = null;
        }

        io.to(roomCode).emit('presentationStatusChanged', { teamId, status });
    });

    // 4. 학생: 실시간 투표 (발표 중)
    socket.on('vote', ({ roomCode, teamId, type, reason }) => {
        const room = rooms[roomCode];
        if (!room || room.currentPresentation !== teamId) return; // 발표 중이 아닐 때 투표 불가
        
        const student = room.students[socket.id];
        if (!student) return;

        // 쿨타임 체크 (예: 5초)
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

        // 채팅으로 이유 전송
        if (reason && reason.trim() !== '') {
            const chatMsg = {
                sender: `${student.studentId} ${student.studentName}`,
                message: reason,
                type: type,
                teamId: teamId
            };
            room.chats.push(chatMsg);
            io.to(roomCode).emit('newChat', chatMsg);
        }

        // 모든 방 인원에게 가격 업데이트 알림
        io.to(roomCode).emit('priceUpdated', { teamId, price: team.price, history: team.history, votes: team.votes });
    });

    // 5. 학생: 채팅 (이유 작성)
    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const student = room.students[socket.id];
        if (!student) return;

        const chatMsg = {
            sender: `${student.studentId} ${student.studentName}`,
            message: message,
            type: 'neutral'
        };
        room.chats.push(chatMsg);
        io.to(roomCode).emit('newChat', chatMsg);
    });

    // 6. 학생: 주식 매수/매도 (발표 후)
    socket.on('trade', ({ roomCode, teamId, action, amount }, callback) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        // 발표 중일 때는 매매 불가 (요구사항: 발표 직후)
        // 단, 교사가 발표 종료를 누른 후에만 가능하도록 할 수도 있으나, 현재 발표중인 팀이 아니면 가능하도록 설정
        if (room.currentPresentation === teamId) {
            return callback({ success: false, message: '현재 발표 진행 중인 모둠은 매매할 수 없습니다.' });
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

    // 교사 방의 현재 상태 요청
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
                    // 방장이 나가면 방 폭파 (옵션)
                    // io.to(socket.roomCode).emit('roomDestroyed');
                    // delete rooms[socket.roomCode];
                } else if (room.students[socket.id]) {
                    // 학생 접속 종료 (데이터는 남겨둘 수도 있고 지울 수도 있음)
                    // 현재는 세션 복구를 지원하지 않으므로 삭제 안함 (재접속 불가하므로 삭제하는게 맞을지도)
                    // 여기선 단순히 교사에게 알림만
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
