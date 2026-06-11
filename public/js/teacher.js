const socket = io();

const roomCode = sessionStorage.getItem('roomCode');
const role = sessionStorage.getItem('role');

if (!roomCode || role !== 'teacher') {
    alert('잘못된 접근입니다.');
    window.location.href = '/';
}

document.getElementById('displayRoomCode').innerText = roomCode;

let roomData = null;
let chart = null;
let currentChatFilter = 'all'; // 채팅 필터 탭 상태
let allChats = []; // 전체 채팅 로컬 보관

const colors = [
    '#F87171', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', 
    '#F472B6', '#38BDF8', '#4ADE80', '#FB923C', '#C084FC'
];

// ─── 게임 단계 UI 업데이트 ───────────────────────────────────────────
function updatePhaseUI(phase) {
    const badge = document.getElementById('phaseBadge');
    const startBtn = document.getElementById('startTradingBtn');
    const endBtn = document.getElementById('endTradingBtn');

    // 단계별 배지 스타일
    const phaseMap = {
        waiting:      { text: '⏳ 대기 중',      cls: 'bg-gray-600 text-gray-300' },
        presentation: { text: '🎤 발표 진행 중', cls: 'bg-blue-600 text-white animate-pulse' },
        trading:      { text: '💹 매매 단계',    cls: 'bg-yellow-500 text-gray-900' },
        ended:        { text: '🏁 종료',         cls: 'bg-red-700 text-white' }
    };
    const p = phaseMap[phase] || phaseMap.waiting;
    badge.textContent = p.text;
    badge.className = `text-sm font-bold px-3 py-1 rounded-full ${p.cls}`;

    // 버튼 가시성 제어
    // 매매 시작 버튼: 발표 중이 아니고 매매 이전 단계일 때만 노출
    startBtn.classList.toggle('hidden', phase === 'trading' || phase === 'ended');
    // 매매 종료 버튼: 매매 단계에만 노출
    endBtn.classList.toggle('hidden', phase !== 'trading');
}

// ─── 차트 초기화 ──────────────────────────────────────────────────────
function initChart(teams) {
    const ctx = document.getElementById('stockChart').getContext('2d');
    const datasets = [];
    let i = 0;
    for (const teamId in teams) {
        const team = teams[teamId];
        datasets.push({
            label: team.name,
            data: team.history,
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length],
            borderWidth: 2,
            tension: 0.1,
            fill: false
        });
        i++;
    }
    chart = new Chart(ctx, {
        type: 'line',
        data: { labels: ['시작'], datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false },
                y: {
                    beginAtZero: false,
                    grid: { color: '#374151' },
                    ticks: { color: '#D1D5DB' }
                }
            },
            plugins: { legend: { labels: { color: '#D1D5DB' } } },
            animation: { duration: 500 }
        }
    });
}

// ─── 차트 데이터 갱신 ─────────────────────────────────────────────────
function updateChart(teamId, price, history) {
    if (!chart) return;
    const dataset = chart.data.datasets.find(ds => ds.label === roomData.teams[teamId].name);
    if (dataset) {
        dataset.data = history;
        const maxLength = Math.max(...chart.data.datasets.map(ds => ds.data.length));
        if (chart.data.labels.length < maxLength) chart.data.labels.push('');
        chart.update();
    }
}

// ─── 모둠 테이블 렌더링 ───────────────────────────────────────────────
function renderTeams() {
    const tbody = document.getElementById('teamListBody');
    tbody.innerHTML = '';
    for (const teamId in roomData.teams) {
        const team = roomData.teams[teamId];
        const isPresenting = roomData.currentPresentation === teamId;
        const phase = roomData.phase;
        // 발표 제어 버튼: 매매/종료 단계에서는 숨김
        let ctrlHtml = '';
        if (phase !== 'trading' && phase !== 'ended') {
            if (isPresenting) {
                ctrlHtml = `<button onclick="setPresentation('${teamId}', 'end')" class="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm font-bold w-28">발표 종료</button>`;
            } else {
                const disabled = roomData.currentPresentation ? 'opacity-50 cursor-not-allowed' : '';
                const disabledAttr = roomData.currentPresentation ? 'disabled' : '';
                ctrlHtml = `<button onclick="setPresentation('${teamId}', 'start')" class="bg-green-500 hover:bg-green-600 px-3 py-1 rounded text-sm font-bold w-28 ${disabled}" ${disabledAttr}>발표 시작</button>`;
            }
        } else {
            ctrlHtml = `<span class="text-gray-500 text-sm">${phase === 'trading' ? '매매 중' : '종료'}</span>`;
        }

        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700 hover:bg-gray-700 transition';
        tr.id = `row-${teamId}`;
        tr.innerHTML = `
            <td class="p-3 font-semibold">${team.name}</td>
            <td class="p-3 font-mono font-bold text-yellow-300" id="price-${teamId}">${team.price.toLocaleString()}원</td>
            <td class="p-3 text-green-400 font-bold" id="up-${teamId}">${team.votes.up}</td>
            <td class="p-3 text-red-400 font-bold" id="down-${teamId}">${team.votes.down}</td>
            <td class="p-3">${ctrlHtml}</td>
        `;
        tbody.appendChild(tr);
    }
}

// ─── 학생 리스트 렌더링 ───────────────────────────────────────────────
function renderStudents() {
    const list = document.getElementById('studentList');
    list.innerHTML = '';
    const students = Object.values(roomData.students);
    document.getElementById('studentCount').innerText = `${students.length}명`;
    students.forEach(s => {
        const div = document.createElement('div');
        div.className = 'bg-gray-700 p-2 rounded text-sm flex justify-between items-center';
        div.innerHTML = `
            <span><span class="font-mono text-gray-400">${s.studentId}</span> ${s.studentName}</span>
            <span class="text-yellow-300 font-mono">${s.cash.toLocaleString()}원</span>
        `;
        list.appendChild(div);
    });
}

// ─── 채팅 탭 초기화 ──────────────────────────────────────────────────
function initChatTabs(teams) {
    const tabsEl = document.getElementById('chatTabs');
    // 기존 전체 버튼 유지, 모둠별 탭 추가
    for (const teamId in teams) {
        const team = teams[teamId];
        const btn = document.createElement('button');
        btn.className = 'chat-tab-btn px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600';
        btn.dataset.tab = teamId;
        btn.textContent = team.name;
        btn.onclick = () => filterChat(teamId);
        tabsEl.appendChild(btn);
    }
}

// ─── 채팅 탭 필터 ────────────────────────────────────────────────────
window.filterChat = function(tab) {
    currentChatFilter = tab;
    // 탭 버튼 활성 스타일
    document.querySelectorAll('.chat-tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.className = 'chat-tab-btn active-tab px-3 py-1 rounded text-sm bg-blue-600';
        } else {
            btn.className = 'chat-tab-btn px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600';
        }
    });
    // 채팅박스 재렌더링
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '';
    allChats.forEach(chat => {
        if (currentChatFilter === 'all' || chat.teamId === currentChatFilter) {
            appendChatDOM(chat);
        }
    });
    chatBox.scrollTop = chatBox.scrollHeight;
};

// ─── 채팅 메시지 추가 ────────────────────────────────────────────────
function appendChat(chat) {
    allChats.push(chat);
    if (currentChatFilter === 'all' || chat.teamId === currentChatFilter) {
        appendChatDOM(chat);
    }
}

function appendChatDOM(chat) {
    const chatBox = document.getElementById('chatBox');
    const div = document.createElement('div');
    let icon = '💬', textClass = 'text-gray-300';
    if (chat.type === 'up')   { icon = '👍'; textClass = 'text-green-300'; }
    if (chat.type === 'down') { icon = '👎'; textClass = 'text-red-300'; }
    const teamLabel = chat.teamName ? `<span class="bg-gray-700 text-xs px-1 py-0.5 rounded mr-1">${chat.teamName}</span>` : '';
    div.className = 'text-sm border-b border-gray-700 pb-1';
    div.innerHTML = `<span class="font-bold text-gray-400">${chat.sender}</span> ${teamLabel}<span class="${textClass}">${icon} ${chat.message}</span>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ─── 게임 단계 전환 (교사 → 서버) ───────────────────────────────────
window.setPhase = function(phase) {
    const confirmMsg = phase === 'trading' ? '주식 매매를 시작하시겠습니까? 발표 단계가 종료됩니다.' : '매매를 종료하고 최종 결과를 확정하시겠습니까?';
    if (!confirm(confirmMsg)) return;
    socket.emit('setPhase', { roomCode, phase }, (res) => {
        if (res && res.success) {
            roomData.phase = phase;
            roomData.currentPresentation = null;
            updatePhaseUI(phase);
            renderTeams();
        }
    });
};

// ─── 발표 제어 ───────────────────────────────────────────────────────
window.setPresentation = function(teamId, status) {
    socket.emit('setPresentation', { roomCode, teamId, status });
};

// ─── 초기 방 상태 로드 ───────────────────────────────────────────────
socket.emit('requestRoomState', roomCode, (response) => {
    if (response.success) {
        roomData = response.roomData;
        initChart(roomData.teams);
        initChatTabs(roomData.teams);
        renderTeams();
        renderStudents();
        updatePhaseUI(roomData.phase || 'waiting');
        // 기존 채팅 복원
        (roomData.chats || []).forEach(chat => {
            allChats.push(chat);
            appendChatDOM(chat);
        });
    } else {
        alert('방 정보를 불러올 수 없습니다. 다시 접속해주세요.');
        window.location.href = '/';
    }
});

// ─── 소켓 이벤트 리스너 ──────────────────────────────────────────────
socket.on('studentJoined', (student) => {
    roomData.students[student.socketId] = student;
    renderStudents();
});

socket.on('studentLeft', (socketId) => {
    // 데이터 유지 정책
});

socket.on('presentationStatusChanged', ({ teamId, status, phase }) => {
    roomData.currentPresentation = status === 'start' ? teamId : null;
    roomData.phase = phase || roomData.phase;
    updatePhaseUI(roomData.phase);
    renderTeams();
});

socket.on('phaseChanged', ({ phase }) => {
    roomData.phase = phase;
    roomData.currentPresentation = null;
    updatePhaseUI(phase);
    renderTeams();
});

socket.on('priceUpdated', ({ teamId, price, history, votes }) => {
    const oldPrice = roomData.teams[teamId].price;
    roomData.teams[teamId].price = price;
    roomData.teams[teamId].history = history;
    roomData.teams[teamId].votes = votes;

    const priceTd = document.getElementById(`price-${teamId}`);
    if (priceTd) {
        priceTd.innerText = `${price.toLocaleString()}원`;
        priceTd.classList.remove('flash-up', 'flash-down');
        void priceTd.offsetWidth;
        if (price > oldPrice) priceTd.classList.add('flash-up');
        else if (price < oldPrice) priceTd.classList.add('flash-down');
    }
    const upTd = document.getElementById(`up-${teamId}`);
    if (upTd) upTd.innerText = votes.up;
    const downTd = document.getElementById(`down-${teamId}`);
    if (downTd) downTd.innerText = votes.down;
    updateChart(teamId, price, history);
});

socket.on('newChat', (chatMsg) => {
    appendChat(chatMsg);
});

// ─── 엑셀 내보내기 ───────────────────────────────────────────────────
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if (!roomData) return;

    // 1. 학생별 최종 자산 및 순위
    const studentsArray = Object.values(roomData.students).map(s => {
        let totalAsset = s.cash;
        for (const tId in s.portfolio) {
            totalAsset += s.portfolio[tId] * roomData.teams[tId].price;
        }
        return { '학번': s.studentId, '이름': s.studentName, '남은 현금': s.cash, '최종 총 자산': totalAsset };
    });
    studentsArray.sort((a, b) => b['최종 총 자산'] - a['최종 총 자산']);
    studentsArray.forEach((s, idx) => s['순위'] = idx + 1);

    // 2. 모둠별 최종 주가 및 상승률
    const teamsArray = Object.values(roomData.teams).map(t => {
        const startPrice = t.history[0];
        const endPrice = t.price;
        const rate = ((endPrice - startPrice) / startPrice * 100).toFixed(2);
        return { '모둠명': t.name, '초기 주가': startPrice, '최종 주가': endPrice, '상승률(%)': rate + '%', '긍정 투표수': t.votes.up, '부정 투표수': t.votes.down };
    });

    // 3. 모둠별 학생 의견 (발표 당시 채팅)
    const teamChatSheets = {};
    for (const teamId in roomData.teams) {
        teamChatSheets[teamId] = [];
    }
    allChats.forEach(chat => {
        if (chat.teamId && teamChatSheets[chat.teamId] !== undefined) {
            const emoji = chat.type === 'up' ? '👍' : chat.type === 'down' ? '👎' : '💬';
            teamChatSheets[chat.teamId].push({
                '발표 모둠': chat.teamName || '',
                '학생': chat.sender,
                '반응': emoji,
                '의견 내용': chat.message
            });
        }
    });

    const wb = XLSX.utils.book_new();
    const wsStudents = XLSX.utils.json_to_sheet(studentsArray);
    XLSX.utils.book_append_sheet(wb, wsStudents, "학생별 최종 순위");
    const wsTeams = XLSX.utils.json_to_sheet(teamsArray);
    XLSX.utils.book_append_sheet(wb, wsTeams, "모둠별 최종 결과");

    // 모둠별 의견 시트 추가
    for (const teamId in roomData.teams) {
        const sheetName = `${roomData.teams[teamId].name} 의견`;
        const data = teamChatSheets[teamId];
        if (data.length > 0) {
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        } else {
            const ws = XLSX.utils.json_to_sheet([{ '발표 모둠': '의견 없음', '학생': '', '반응': '', '의견 내용': '' }]);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
    }

    XLSX.writeFile(wb, `모의투자_결과_${roomCode}.xlsx`);
});
