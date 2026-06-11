const socket = io();

// 요소
const joinForm = document.getElementById('joinForm');
const createForm = document.getElementById('createForm');

if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();
        const studentId = document.getElementById('studentId').value.trim();
        const studentName = document.getElementById('studentName').value.trim();

        socket.emit('joinRoom', { roomCode, studentId, studentName }, (response) => {
            if (response.success) {
                // sessionStorage에 데이터 저장
                sessionStorage.setItem('roomCode', roomCode);
                sessionStorage.setItem('studentId', studentId);
                sessionStorage.setItem('studentName', studentName);
                sessionStorage.setItem('role', 'student');
                // 학생 화면으로 이동
                window.location.href = '/student.html';
            } else {
                alert(response.message);
            }
        });
    });
}

if (createForm) {
    createForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const numTeams = document.getElementById('numTeams').value;
        const initialCash = document.getElementById('initialCash').value;

        socket.emit('createRoom', { numTeams, initialCash }, (response) => {
            if (response.success) {
                // sessionStorage에 데이터 저장
                sessionStorage.setItem('roomCode', response.roomCode);
                sessionStorage.setItem('role', 'teacher');
                // 교사 화면으로 이동
                window.location.href = '/teacher.html';
            } else {
                alert('방 생성에 실패했습니다.');
            }
        });
    });
}
