const socket = io();

const roomCode = sessionStorage.getItem('roomCode');
const studentId = sessionStorage.getItem('studentId');
const studentName = sessionStorage.getItem('studentName');
const role = sessionStorage.getItem('role');

if (!roomCode || !studentId || role !== 'student') {
    alert('잘못된 접근입니다.');
    window.location.href = '/';
}

document.getElementById('studentInfo').innerText = `${roomCode} / ${studentId} ${studentName}`;

// ─── 상태 변수 ─────────────────────────────────────────────────────────
let teams = {};
let currentPresentation = null;
let currentPhase = 'waiting';
// 현재 발표에 대한 클릭 기록: { count: 0~10, types: [] }
let currentVoteRecord = { count: 0, types: [] };
const MAX_CLICKS = 10;
let pendingPostEvalTeamId = null; // 사후 평가 대기 중인 팀 ID

// ─── 방 접속 및 재접속 처리 ──────────────────────────────────────────
socket.on('connect', () => {
    socket.emit('joinRoom', { roomCode, studentId, studentName }, (response) => {
        if (response.success) {
            teams = response.roomData.teams;
            currentPresentation = response.roomData.currentPresentation;
            currentPhase = response.roomData.phase || 'waiting';

            // 내 투표 기록 복원
            if (response.studentData && response.studentData.presentationVotes) {
                const myVotes = response.studentData.presentationVotes[currentPresentation];
                if (myVotes) {
                    currentVoteRecord.count = myVotes.count;
                    currentVoteRecord.types = myVotes.types;
                    for (let i = 0; i < myVotes.count; i++) {
                        updateClickDot(i, myVotes.types[i]);
                    }
                    if (myVotes.count >= MAX_CLICKS) {
                        disableVoteButtons();
                    }
                }
            }

            updatePhaseUI(currentPhase, currentPresentation);
            renderMarket();
        } else {
            alert(response.message);
            window.location.href = '/';
        }
    });
});

// ─── 클릭 카운터 UI 초기화 ────────────────────────────────────────────
function initClickCounter() {
    const container = document.getElementById('clickCounter');
    container.innerHTML = '';
    for (let i = 0; i < MAX_CLICKS; i++) {
        const dot = document.createElement('div');
        dot.className = 'click-dot';
        dot.id = `dot-${i}`;
        container.appendChild(dot);
    }
    document.getElementById('remainingCount').textContent = `${MAX_CLICKS}번`;
    document.getElementById('allUsedMsg').classList.add('hidden');
}

// ─── 클릭 카운터 점 업데이트 ──────────────────────────────────────────
function updateClickDot(index, type) {
    const dot = document.getElementById(`dot-${index}`);
    if (!dot) return;
    dot.classList.remove('used-up', 'used-hold', 'used-down');
    if (type === 'up')   dot.classList.add('used-up');
    if (type === 'hold') dot.classList.add('used-hold');
    if (type === 'down') dot.classList.add('used-down');
}

// ─── 게임 단계 UI 업데이트 ───────────────────────────────────────────
function updatePhaseUI(phase, presentingTeamId) {
    const presentationSection = document.getElementById('presentationSection');
    const waitingBanner       = document.getElementById('waitingBanner');
    const endedBanner         = document.getElementById('endedBanner');
    const badge               = document.getElementById('phaseBadge');

    presentationSection.classList.add('hidden');
    waitingBanner.classList.add('hidden');
    endedBanner.classList.add('hidden');

    if (phase === 'presentation' && presentingTeamId) {
        // 발표 중: 발표 섹션 표시
        presentationSection.classList.remove('hidden');
        const team = teams[presentingTeamId];
        document.getElementById('currentTeamName').innerText = team?.name || '';
        document.getElementById('currentPrice').innerText = `$${(team?.price || 100).toFixed(2)}`;
        badge.textContent = '🎤 발표 중';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-blue-600 text-white animate-pulse';
        // 새로운 발표 시작 시 카운터 초기화
        currentVoteRecord = { count: 0, types: [] };
        initClickCounter();
    } else if (phase === 'ended') {
        endedBanner.classList.remove('hidden');
        badge.textContent = '🏁 종료';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-red-700 text-white';
        // 학생 사후평가 모달 표시 (아직 안 했다면)
        showPostEvalModalIfNeeded();
    } else {
        waitingBanner.classList.remove('hidden');
        badge.textContent = '⏳ 대기 중';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-gray-600 text-gray-300';
    }

    renderMarket();
}

// ─── 시장 현황 렌더링 ─────────────────────────────────────────────────
function renderMarket() {
    const list = document.getElementById('marketList');
    list.innerHTML = '';

    for (const teamId in teams) {
        const team = teams[teamId];
        const isPresenting = currentPresentation === teamId;
        const startPrice = team.history ? team.history[0] : 100;
        const change = team.price - startPrice;
        const changePercent = ((change / startPrice) * 100).toFixed(1);
        const changeColor = change > 0 ? 'text-red-400' : change < 0 ? 'text-blue-400' : 'text-gray-400';
        const changeIcon = change > 0 ? '▲' : change < 0 ? '▼' : '━';

        const div = document.createElement('div');
        div.className = `rounded-xl p-3 border ${isPresenting ? 'border-blue-500 bg-blue-900 bg-opacity-30' : 'border-gray-600 bg-gray-700'}`;
        div.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2">
                    ${isPresenting ? '<span class="text-blue-400 text-xs font-bold animate-pulse">🎤 발표 중</span>' : ''}
                    <span class="font-bold">${team.name}</span>
                </div>
                <div class="text-right">
                    <div class="font-mono font-bold text-yellow-300 text-lg" id="mkt-price-${teamId}">$${team.price.toFixed(2)}</div>
                    <div class="text-xs ${changeColor}">${changeIcon} ${Math.abs(change).toFixed(2)} (${changePercent}%)</div>
                </div>
            </div>
            <div class="mt-2 flex gap-3 text-xs text-gray-400">
                <span>📈 매수: <span class="text-red-400 font-bold">${team.votes?.up || 0}</span></span>
                <span>⏸ 관망: <span class="text-gray-300 font-bold">${team.votes?.hold || 0}</span></span>
                <span>📉 매도: <span class="text-blue-400 font-bold">${team.votes?.down || 0}</span></span>
            </div>
        `;
        list.appendChild(div);
    }
}

// ─── 투표 (매수/관망/매도) ──────────────────────────────────────────────
window.vote = function(type) {
    if (!currentPresentation || currentPhase !== 'presentation') return;
    if (currentVoteRecord.count >= MAX_CLICKS) {
        showVoteError(`이미 ${MAX_CLICKS}번 모두 투자했습니다!`);
        return;
    }
    socket.emit('vote', { roomCode, teamId: currentPresentation, type });
};

// ─── 서버로부터 투표 확인 응답 ──────────────────────────────────────────
socket.on('voteConfirmed', ({ teamId, type, count, remaining }) => {
    // 클릭 기록 업데이트
    const idx = count - 1;
    currentVoteRecord.count = count;
    currentVoteRecord.types[idx] = type;
    updateClickDot(idx, type);

    // 남은 횟수 업데이트
    document.getElementById('remainingCount').textContent = remaining > 0 ? `${remaining}번` : '0번 (완료!)';

    // 버튼 피드백
    const btnId = type === 'up' ? 'voteUpBtn' : type === 'hold' ? 'voteHoldBtn' : 'voteDownBtn';
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => { btn.style.transform = ''; }, 150);
    }

    // 10번 완료
    if (count >= MAX_CLICKS) {
        document.getElementById('allUsedMsg').classList.remove('hidden');
        disableVoteButtons();
    }
});

// ─── 사후 평가 요청 (서버에서 10번 완료 시 전송) ───────────────────────
socket.on('requestPostEval', ({ teamId, teamName }) => {
    pendingPostEvalTeamId = teamId;
    document.getElementById('evalTeamName').textContent = teamName;
    document.getElementById('evalReason').value = '';
    const modal = document.getElementById('postEvalModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => document.getElementById('evalReason').focus(), 300);
});

// ─── 사후 평가 제출 ───────────────────────────────────────────────────
window.submitPostEval = function() {
    const reason = document.getElementById('evalReason').value.trim();
    if (pendingPostEvalTeamId) {
        socket.emit('submitPostEval', { roomCode, teamId: pendingPostEvalTeamId, reason });
    }
    closePostEvalModal();
};

// ─── 사후 평가 건너뛰기 ────────────────────────────────────────────────
window.skipPostEval = function() {
    closePostEvalModal();
};

function closePostEvalModal() {
    const modal = document.getElementById('postEvalModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    pendingPostEvalTeamId = null;
}

// ─── 투표 버튼 비활성화 ────────────────────────────────────────────────
function disableVoteButtons() {
    ['voteUpBtn', 'voteHoldBtn', 'voteDownBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
        }
    });
}

// ─── 투표 버튼 활성화 ─────────────────────────────────────────────────
function enableVoteButtons() {
    ['voteUpBtn', 'voteHoldBtn', 'voteDownBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    });
}

// ─── 에러 메시지 표시 ─────────────────────────────────────────────────
function showVoteError(msg) {
    const el = document.getElementById('voteMessage');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── 소켓 이벤트: 발표 상태 변경 ────────────────────────────────────
socket.on('presentationStatusChanged', ({ teamId, status, phase }) => {
    currentPresentation = status === 'start' ? teamId : null;
    currentPhase = phase || currentPhase;
    // 새 발표 시작 시 버튼 활성화 + 카운터 초기화
    if (status === 'start') {
        currentVoteRecord = { count: 0, types: [] };
        enableVoteButtons();
    }
    updatePhaseUI(currentPhase, currentPresentation);
});

// ─── 소켓 이벤트: 게임 단계 변경 ────────────────────────────────────
socket.on('phaseChanged', ({ phase }) => {
    currentPhase = phase;
    currentPresentation = null;
    updatePhaseUI(currentPhase, null);
});

// ─── 소켓 이벤트: 주가 업데이트 ─────────────────────────────────────
socket.on('priceUpdated', ({ teamId, price, history, votes }) => {
    const oldPrice = teams[teamId]?.price || price;
    teams[teamId].price = price;
    teams[teamId].history = history;
    if (votes) teams[teamId].votes = votes;

    // 현재 발표 중인 팀이면 헤더 주가도 업데이트
    if (currentPresentation === teamId) {
        const priceEl = document.getElementById('currentPrice');
        if (priceEl) {
            priceEl.textContent = `$${price.toFixed(2)}`;
            priceEl.classList.add('price-blink');
            setTimeout(() => priceEl.classList.remove('price-blink'), 1000);
        }
    }

    // 시장 현황 해당 팀 주가 업데이트
    const mktPriceEl = document.getElementById(`mkt-price-${teamId}`);
    if (mktPriceEl) {
        mktPriceEl.textContent = `$${price.toFixed(2)}`;
        mktPriceEl.classList.remove('text-yellow-300', 'text-red-400', 'text-blue-400');
        if (price > oldPrice) mktPriceEl.classList.add('text-red-400');
        else if (price < oldPrice) mktPriceEl.classList.add('text-blue-400');
        else mktPriceEl.classList.add('text-yellow-300');
        setTimeout(() => {
            if (mktPriceEl) {
                mktPriceEl.classList.remove('text-red-400', 'text-blue-400');
                mktPriceEl.classList.add('text-yellow-300');
            }
        }, 1000);
    }

    renderMarket();
});

socket.on('voteError', ({ message }) => {
    showVoteError(message);
});
