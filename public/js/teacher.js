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
let currentChatFilter = 'all';
let allChats = [];

const colors = [
    '#F87171', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', 
    '#F472B6', '#38BDF8', '#4ADE80', '#FB923C', '#C084FC'
];

// ─── 게임 단계 UI 업데이트 ───────────────────────────────────────────
function updatePhaseUI(phase) {
    const badge = document.getElementById('phaseBadge');
    const startBtn = document.getElementById('startTradingBtn');
    const endBtn = document.getElementById('endTradingBtn');

    const phaseMap = {
        waiting:      { text: '⏳ 대기 중',      cls: 'bg-gray-600 text-gray-300' },
        presentation: { text: '🎤 발표 진행 중', cls: 'bg-blue-600 text-white animate-pulse' },
        trading:      { text: '💹 매매 단계',    cls: 'bg-yellow-500 text-gray-900' },
        ended:        { text: '🏁 종료',         cls: 'bg-red-700 text-white' }
    };
    const p = phaseMap[phase] || phaseMap.waiting;
    badge.textContent = p.text;
    badge.className = `text-sm font-bold px-3 py-1 rounded-full ${p.cls}`;

    startBtn.classList.toggle('hidden', phase === 'trading' || phase === 'ended');
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
            tension: 0.3,
            fill: false,
            pointRadius: 3
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
                    ticks: {
                        color: '#D1D5DB',
                        // 달러 형식으로 표시
                        callback: (val) => `$${val.toFixed(2)}`
                    }
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
        // 발표 제어 버튼
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
        tr.className = `border-b border-gray-700 hover:bg-gray-700 transition ${isPresenting ? 'bg-blue-900 bg-opacity-30' : ''}`;
        tr.id = `row-${teamId}`;
        tr.innerHTML = `
            <td class="p-3 font-semibold">${team.name}${isPresenting ? ' <span class="text-blue-400 text-xs">🎤</span>' : ''}</td>
            <td class="p-3 font-mono font-bold text-yellow-300" id="price-${teamId}">$${team.price.toFixed(2)}</td>
            <td class="p-3 text-red-400 font-bold" id="up-${teamId}">${team.votes?.up || 0}</td>
            <td class="p-3 text-gray-400 font-bold" id="hold-${teamId}">${team.votes?.hold || 0}</td>
            <td class="p-3 text-blue-400 font-bold" id="down-${teamId}">${team.votes?.down || 0}</td>
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
            <span class="text-xs text-gray-400">접속 중</span>
        `;
        list.appendChild(div);
    });
}

// ─── 채팅 탭 초기화 ──────────────────────────────────────────────────
function initChatTabs(teams) {
    const tabsEl = document.getElementById('chatTabs');
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
    document.querySelectorAll('.chat-tab-btn').forEach(btn => {
        btn.className = btn.dataset.tab === tab
            ? 'chat-tab-btn active-tab px-3 py-1 rounded text-sm bg-blue-600'
            : 'chat-tab-btn px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600';
    });
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
    if (chat.type === 'up')   { icon = '📈'; textClass = 'text-red-300'; }
    if (chat.type === 'hold') { icon = '⏸'; textClass = 'text-gray-300'; }
    if (chat.type === 'down') { icon = '📉'; textClass = 'text-blue-300'; }
    if (chat.type === 'eval') { icon = '📝'; textClass = 'text-yellow-300'; }
    const teamLabel = chat.teamName ? `<span class="bg-gray-700 text-xs px-1 py-0.5 rounded mr-1">${chat.teamName}</span>` : '';
    const evalLabel = chat.type === 'eval' ? '<span class="text-xs text-yellow-500 font-bold mr-1">[투자분석]</span>' : '';
    div.className = 'text-sm border-b border-gray-700 pb-1';
    div.innerHTML = `<span class="font-bold text-gray-400">${chat.sender}</span> ${teamLabel}${evalLabel}<span class="${textClass}">${icon} ${chat.message}</span>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ─── 게임 단계 전환 (교사 → 서버) ───────────────────────────────────
window.setPhase = function(phase) {
    const confirmMsg = phase === 'trading' ? '매매 단계를 시작하시겠습니까? 발표 단계가 종료됩니다.' : '평가를 종료하고 최종 결과를 확정하시겠습니까?';
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
socket.emit('requestRoomState', { roomCode, role: 'teacher' }, (response) => {
    if (response.success) {
        roomData = response.roomData;
        initChart(roomData.teams);
        initChatTabs(roomData.teams);
        renderTeams();
        renderStudents();
        updatePhaseUI(roomData.phase || 'waiting');

        // 서버의 채팅 복원
        (roomData.chats || []).forEach(chat => {
            allChats.push(chat);
            appendChatDOM(chat);
        });

        // 세션 파일에서 복원한 추가 채팅 (sessionStorage에 임시 저장된 것)
        const restoredChatsRaw = sessionStorage.getItem('restoredChats');
        if (restoredChatsRaw) {
            try {
                const restoredChats = JSON.parse(restoredChatsRaw);
                // 서버 채팅과 중복 제거 후 추가
                restoredChats.forEach(chat => {
                    const isDuplicate = allChats.some(c =>
                        c.sender === chat.sender &&
                        c.message === chat.message &&
                        c.teamId === chat.teamId
                    );
                    if (!isDuplicate) {
                        allChats.push(chat);
                        appendChatDOM(chat);
                    }
                });
            } catch (e) { /* 파싱 에러 무시 */ }
            sessionStorage.removeItem('restoredChats');
        }
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
    // 데이터 유지 정책: 삭제 안 함
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
        priceTd.innerText = `$${price.toFixed(2)}`;
        priceTd.classList.remove('flash-up', 'flash-down');
        void priceTd.offsetWidth;
        if (price > oldPrice) priceTd.classList.add('flash-up');
        else if (price < oldPrice) priceTd.classList.add('flash-down');
    }
    const upTd = document.getElementById(`up-${teamId}`);
    if (upTd) upTd.innerText = votes?.up || 0;
    const holdTd = document.getElementById(`hold-${teamId}`);
    if (holdTd) holdTd.innerText = votes?.hold || 0;
    const downTd = document.getElementById(`down-${teamId}`);
    if (downTd) downTd.innerText = votes?.down || 0;
    updateChart(teamId, price, history);
});

socket.on('newChat', (chatMsg) => {
    appendChat(chatMsg);
});

// ─── 세션 저장 (JSON 다운로드) ───────────────────────────────────────
document.getElementById('saveSessionBtn').addEventListener('click', () => {
    if (!roomData) return;

    // 저장할 세션 데이터 구성
    const sessionData = {
        roomCode: roomCode,
        savedAt: new Date().toISOString(),
        initialCash: roomData.initialCash,
        phase: roomData.phase,
        teams: roomData.teams,
        students: roomData.students,
        chats: allChats
    };

    // JSON 파일로 다운로드
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `세션_${roomCode}_${new Date().toLocaleDateString('ko-KR').replace(/\. /g, '-').replace('.', '')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    alert(`✅ 세션이 저장되었습니다!\n\n방 코드: ${roomCode}\n다음번에 같은 방 코드로 세션 파일을 업로드하면 이어서 진행할 수 있습니다.`);
});

// ─── 결과 내보내기 (Excel 다운로드) ──────────────────────────────────
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if (!roomData) return;

    // 1. 모둠별 최종 주가 및 투표 현황
    const teamsArray = Object.values(roomData.teams).map(t => {
        const startPrice = t.history[0];
        const endPrice = t.price;
        const change = endPrice - startPrice;
        const changePercent = ((change / startPrice) * 100).toFixed(2);
        return {
            '모둠명': t.name,
            '초기 주가($)': startPrice.toFixed(2),
            '최종 주가($)': endPrice.toFixed(2),
            '변동액($)': change.toFixed(2),
            '변동률(%)': changePercent + '%',
            '📈 매수 투표수': t.votes?.up || 0,
            '⏸ 관망 투표수': t.votes?.hold || 0,
            '📉 매도 투표수': t.votes?.down || 0
        };
    });

    // 2. 학생별 투자 분석 보고서 (사후 평가)
    const evalArray = [];
    Object.values(roomData.students).forEach(s => {
        if (s.postEvalReasons) {
            for (const teamId in s.postEvalReasons) {
                const team = roomData.teams[teamId];
                evalArray.push({
                    '학번': s.studentId,
                    '이름': s.studentName,
                    '평가 대상 모둠': team ? team.name : teamId,
                    '투자 분석 이유': s.postEvalReasons[teamId]
                });
            }
        }
    });

    // 3. 모둠별 실시간 의견 (채팅)
    const teamChatSheets = {};
    for (const teamId in roomData.teams) {
        teamChatSheets[teamId] = [];
    }
    allChats.forEach(chat => {
        if (chat.teamId && teamChatSheets[chat.teamId] !== undefined) {
            const icon = chat.type === 'up' ? '📈 매수' : chat.type === 'down' ? '📉 매도' : chat.type === 'hold' ? '⏸ 관망' : '📝 분석보고서';
            teamChatSheets[chat.teamId].push({
                '발표 모둠': chat.teamName || '',
                '학생': chat.sender,
                '유형': icon,
                '내용': chat.message
            });
        }
    });

    const wb = XLSX.utils.book_new();

    // 모둠별 최종 결과 시트
    const wsTeams = XLSX.utils.json_to_sheet(teamsArray);
    XLSX.utils.book_append_sheet(wb, wsTeams, "모둠별 최종 결과");

    // 투자 분석 보고서 시트
    if (evalArray.length > 0) {
        const wsEval = XLSX.utils.json_to_sheet(evalArray);
        XLSX.utils.book_append_sheet(wb, wsEval, "투자 분석 보고서");
    } else {
        const wsEval = XLSX.utils.json_to_sheet([{ '안내': '제출된 투자 분석 보고서가 없습니다.' }]);
        XLSX.utils.book_append_sheet(wb, wsEval, "투자 분석 보고서");
    }

    // 모둠별 의견 시트 추가
    for (const teamId in roomData.teams) {
        const sheetName = `${roomData.teams[teamId].name} 의견`;
        const data = teamChatSheets[teamId];
        const ws = data.length > 0
            ? XLSX.utils.json_to_sheet(data)
            : XLSX.utils.json_to_sheet([{ '안내': '의견 없음', '학생': '', '유형': '', '내용': '' }]);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    XLSX.writeFile(wb, `MarketSentiment_결과_${roomCode}.xlsx`);
});
