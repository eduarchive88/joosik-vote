const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// JSON 파싱 미들웨어
app.use(express.json({ limit: '10mb' }));

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

// 주가 변동 가중치 설정 (달러 기준, 소수점 2자리)
// 기본 주가: $100.00
// 투표 영향: up/hold/down 각각 가중치
const PRICE_IMPACT = {
    VOTE_UP: 1.0,    // 매수 → +$1.00
    VOTE_HOLD: 0.0,  // 관망 → 변동 없음
    VOTE_DOWN: -1.0, // 매도 → -$1.00
};
const INITIAL_STOCK_PRICE = 100.00; // $100.00
const MAX_VOTES_PER_PRESENTATION = 10; // 발표당 최대 클릭 횟수

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
                votes: { up: 0, hold: 0, down: 0 }
            };
        }

        rooms[roomCode] = {
            host: socket.id,
            initialCash: parseFloat(initialCash) || 1000.00,
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

        // 학생 초기 데이터 세팅
        room.students[socket.id] = {
            socketId: socket.id,
            studentId,
            studentName,
            cash: room.initialCash,
            // 발표별 투표 정보: { teamId: { count: 0~10, types: ['up','hold',...], reason: '' } }
            presentationVotes: {},
            lastVoteTime: 0,
            // 사후 평가 기록: { teamId: { reason: '' } }
            postEvalReasons: {}
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

        if (phase === 'trading') {
            room.currentPresentation = null;
        }
        room.phase = phase;

        io.to(roomCode).emit('phaseChanged', { phase });
        if (callback) callback({ success: true });
    });

    // 5. 학생: 실시간 투표 (발표 중에만 허용, 10번 제한)
    socket.on('vote', ({ roomCode, teamId, type, reason }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'presentation' || room.currentPresentation !== teamId) return;
        
        const student = room.students[socket.id];
        if (!student) return;

        // 쿨타임 체크 (2초)
        const now = Date.now();
        if (now - student.lastVoteTime < 2000) {
            socket.emit('voteError', { message: '잠시 후 다시 눌러주세요. (2초 쿨타임)' });
            return;
        }

        // 해당 발표의 투표 초기화
        if (!student.presentationVotes[teamId]) {
            student.presentationVotes[teamId] = { count: 0, types: [], reason: '' };
        }

        // 10번 초과 차단
        if (student.presentationVotes[teamId].count >= MAX_VOTES_PER_PRESENTATION) {
            socket.emit('voteError', { message: `이미 ${MAX_VOTES_PER_PRESENTATION}번 모두 투자했습니다!` });
            return;
        }

        // 유효한 타입 확인
        if (!['up', 'hold', 'down'].includes(type)) return;

        student.lastVoteTime = now;
        student.presentationVotes[teamId].count++;
        student.presentationVotes[teamId].types.push(type);

        const team = room.teams[teamId];
        if (type === 'up') {
            team.votes.up++;
            team.price = Math.max(0, Math.round((team.price + PRICE_IMPACT.VOTE_UP) * 100) / 100);
        } else if (type === 'hold') {
            team.votes.hold = (team.votes.hold || 0) + 1;
            // 관망은 주가 변동 없음
        } else if (type === 'down') {
            team.votes.down++;
            team.price = Math.max(0, Math.round((team.price + PRICE_IMPACT.VOTE_DOWN) * 100) / 100);
        }
        
        team.history.push(team.price);

        const voteCount = student.presentationVotes[teamId].count;

        // 모든 방 인원에게 가격 업데이트 알림
        io.to(roomCode).emit('priceUpdated', { teamId, price: team.price, history: team.history, votes: team.votes });

        // 해당 학생에게 투표 카운트 응답
        socket.emit('voteConfirmed', {
            teamId,
            type,
            count: voteCount,
            remaining: MAX_VOTES_PER_PRESENTATION - voteCount
        });

        // 10번 모두 채웠으면 사후 평가 요청 이벤트 발송
        if (voteCount >= MAX_VOTES_PER_PRESENTATION) {
            socket.emit('requestPostEval', { teamId, teamName: team.name });
        }
    });

    // 6. 학생: 사후 평가 이유 제출
    socket.on('submitPostEval', ({ roomCode, teamId, reason }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const student = room.students[socket.id];
        if (!student) return;

        if (!student.postEvalReasons) student.postEvalReasons = {};
        student.postEvalReasons[teamId] = reason;

        const team = room.teams[teamId];

        // 채팅으로도 기록 (투자 분석 보고서 데이터)
        if (reason && reason.trim() !== '') {
            const chatMsg = {
                sender: `${student.studentId} ${student.studentName}`,
                message: reason,
                type: 'eval',
                teamId: teamId,
                teamName: team ? team.name : teamId
            };
            room.chats.push(chatMsg);
            io.to(roomCode).emit('newChat', chatMsg);
        }

        socket.emit('postEvalSubmitted', { teamId });
    });

    // 7. 교사 방의 현재 상태 요청 (재접속 포함)
    socket.on('requestRoomState', ({ roomCode, role: reqRole }, callback) => {
        const room = rooms[roomCode];
        if (room) {
            if (reqRole === 'teacher') {
                room.host = socket.id;
                socket.join(roomCode);
                socket.roomCode = roomCode;
                socket.role = 'teacher';
            }
            callback({ success: true, roomData: room });
        } else {
            callback({ success: false });
        }
    });

    // 8. 세션 복원: JSON 파일에서 방 데이터 복구 (같은 방 코드로)
    socket.on('restoreSession', ({ roomCode, sessionData }, callback) => {
        roomCode = roomCode.toUpperCase();

        // 기존 방이 있으면 병합, 없으면 새로 생성
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                host: socket.id,
                initialCash: sessionData.initialCash || 1000.00,
                teams: sessionData.teams || {},
                students: sessionData.students || {},
                currentPresentation: null,
                phase: 'waiting',
                chats: sessionData.chats || []
            };
        } else {
            // 기존 방에 저장된 데이터 병합 (주가 이력, 투표 기록 보존)
            const room = rooms[roomCode];
            room.teams = sessionData.teams || room.teams;
            // 학생 데이터는 유지 (재접속한 학생 우선)
        }

        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.role = 'teacher';
        rooms[roomCode].host = socket.id;

        callback({ success: true, roomCode, roomData: rooms[roomCode] });
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
