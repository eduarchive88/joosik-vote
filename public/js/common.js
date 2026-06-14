const socket = io();

// ─── 요소 ──────────────────────────────────────────────────────────────
const joinForm   = document.getElementById('joinForm');
const createForm = document.getElementById('createForm');

// ─── 탭 전환 (새 방 만들기 / 세션 이어하기) ────────────────────────────
window.switchTab = function(tab) {
    const panelNew     = document.getElementById('panelNew');
    const panelRestore = document.getElementById('panelRestore');
    const tabNew       = document.getElementById('tabNew');
    const tabRestore   = document.getElementById('tabRestore');

    if (tab === 'new') {
        panelNew.classList.remove('hidden');
        panelRestore.classList.add('hidden');
        tabNew.className     = 'flex-1 py-2 rounded-xl text-sm font-bold bg-yellow-600 text-white transition';
        tabRestore.className = 'flex-1 py-2 rounded-xl text-sm font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 transition';
    } else {
        panelNew.classList.add('hidden');
        panelRestore.classList.remove('hidden');
        tabNew.className     = 'flex-1 py-2 rounded-xl text-sm font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 transition';
        tabRestore.className = 'flex-1 py-2 rounded-xl text-sm font-bold bg-yellow-600 text-white transition';
    }
};

// ─── 학생 입장 폼 ──────────────────────────────────────────────────────
if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomCode   = document.getElementById('roomCode').value.trim().toUpperCase();
        const studentId  = document.getElementById('studentId').value.trim();
        const studentName = document.getElementById('studentName').value.trim();

        socket.emit('joinRoom', { roomCode, studentId, studentName }, (response) => {
            if (response.success) {
                sessionStorage.setItem('roomCode',    roomCode);
                sessionStorage.setItem('studentId',   studentId);
                sessionStorage.setItem('studentName', studentName);
                sessionStorage.setItem('role',        'student');
                window.location.href = '/student.html';
            } else {
                alert(response.message);
            }
        });
    });
}

// ─── 새 방 만들기 폼 ──────────────────────────────────────────────────
if (createForm) {
    createForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const numTeams      = document.getElementById('numTeams').value;
        const customRoomCode = document.getElementById('customRoomCode').value;

        socket.emit('createRoom', { numTeams, initialCash: 1000.00, customRoomCode }, (response) => {
            if (response.success) {
                sessionStorage.setItem('roomCode', response.roomCode);
                sessionStorage.setItem('role',     'teacher');
                window.location.href = '/teacher.html';
            } else {
                alert(response.message || '방 생성에 실패했습니다.');
            }
        });
    });
}

// ─── 세션 복원: 파일 업로드 처리 ──────────────────────────────────────
let loadedSessionData = null;

const sessionFileInput = document.getElementById('sessionFile');
const dropZone         = document.getElementById('dropZone');
const sessionPreview   = document.getElementById('sessionPreview');
const sessionInfo      = document.getElementById('sessionInfo');

// 드래그 앤 드롭
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) readSessionFile(file);
    });
}

// 파일 선택
if (sessionFileInput) {
    sessionFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) readSessionFile(file);
    });
}

function readSessionFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.roomCode || !data.teams) {
                alert('올바른 세션 파일이 아닙니다.');
                return;
            }
            loadedSessionData = data;

            // 미리보기 표시
            const savedAt = data.savedAt ? new Date(data.savedAt).toLocaleString('ko-KR') : '알 수 없음';
            const teamNames = Object.values(data.teams).map(t => t.name).join(', ');
            const studentCount = Object.keys(data.students || {}).length;
            const chatCount = (data.chats || []).length;

            sessionInfo.innerHTML = `
                <div>🔑 방 코드: <span class="text-yellow-300 font-bold">${data.roomCode}</span></div>
                <div>📅 저장 시각: ${savedAt}</div>
                <div>🏢 모둠: ${teamNames}</div>
                <div>👨‍🎓 기존 학생 수: ${studentCount}명</div>
                <div>💬 저장된 의견: ${chatCount}건</div>
            `;
            sessionPreview.classList.remove('hidden');
        } catch (err) {
            alert('파일 파싱 오류: 올바른 JSON 파일인지 확인하세요.\n' + err.message);
        }
    };
    reader.readAsText(file, 'utf-8');
}

// ─── 세션 이어하기 실행 ────────────────────────────────────────────────
const restoreBtn = document.getElementById('restoreBtn');
if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
        if (!loadedSessionData) return;

        const roomCode = loadedSessionData.roomCode;
        // 서버에 세션 복원 요청
        socket.emit('restoreSession', { roomCode, sessionData: loadedSessionData }, (response) => {
            if (response.success) {
                sessionStorage.setItem('roomCode', roomCode);
                sessionStorage.setItem('role',     'teacher');
                // 복원된 채팅 임시 저장 (teacher.js에서 사용)
                sessionStorage.setItem('restoredChats', JSON.stringify(loadedSessionData.chats || []));
                window.location.href = '/teacher.html';
            } else {
                alert('세션 복원에 실패했습니다. 다시 시도해주세요.');
            }
        });
    });
}
