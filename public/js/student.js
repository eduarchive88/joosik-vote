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

let myCash = 0;
let myPortfolio = {};
let teams = {};
let currentPresentation = null;
let currentPhase = 'waiting'; // 현재 게임 단계
let selectedTeamIdForTrade = null;

// ─── 방 접속 ─────────────────────────────────────────────────────────
socket.emit('joinRoom', { roomCode, studentId, studentName }, (response) => {
    if (response.success) {
        myCash = response.studentData.cash;
        myPortfolio = response.studentData.portfolio;
        teams = response.roomData.teams;
        currentPresentation = response.roomData.currentPresentation;
        currentPhase = response.roomData.phase || 'waiting';
        
        updateCashUI();
        updatePhaseUI(currentPhase, currentPresentation);
        renderPortfolio();
    } else {
        alert(response.message);
        window.location.href = '/';
    }
});

// ─── 현금 UI ─────────────────────────────────────────────────────────
function updateCashUI() {
    document.getElementById('myCash').innerText = `${myCash.toLocaleString()}원`;
}

// ─── 게임 단계별 UI 전환 ──────────────────────────────────────────────
function updatePhaseUI(phase, presentingTeamId) {
    const waitingBanner     = document.getElementById('waitingBanner');
    const waitingMsg        = document.getElementById('waitingMsg');
    const presentationSection = document.getElementById('presentationSection');
    const tradingBanner     = document.getElementById('tradingBanner');
    const endedBanner       = document.getElementById('endedBanner');
    const badge             = document.getElementById('phaseBadge');

    // 모두 숨기고 시작
    waitingBanner.classList.add('hidden');
    presentationSection.classList.add('hidden');
    tradingBanner.classList.add('hidden');
    endedBanner.classList.add('hidden');

    if (phase === 'presentation' && presentingTeamId) {
        // 발표 중: 발표 섹션 표시
        presentationSection.classList.remove('hidden');
        document.getElementById('currentTeamName').innerText = teams[presentingTeamId]?.name || '';
        badge.textContent = '🎤 발표 중';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-blue-600 text-white animate-pulse';
    } else if (phase === 'waiting' || phase === 'presentation') {
        // 대기 중 (발표 없음)
        waitingBanner.classList.remove('hidden');
        waitingMsg.textContent = '⏳ 교사의 발표 시작 신호를 기다리고 있습니다.';
        badge.textContent = '⏳ 대기 중';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-gray-600 text-gray-300';
    } else if (phase === 'trading') {
        // 매매 단계
        tradingBanner.classList.remove('hidden');
        badge.textContent = '💹 매매 중';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-yellow-500 text-gray-900';
    } else if (phase === 'ended') {
        // 종료
        endedBanner.classList.remove('hidden');
        badge.textContent = '🏁 종료';
        badge.className = 'text-xs font-bold px-2 py-1 rounded-full bg-red-700 text-white';
    }

    renderPortfolio();
}

// ─── 포트폴리오 렌더링 ────────────────────────────────────────────────
function renderPortfolio() {
    const list = document.getElementById('portfolioList');
    list.innerHTML = '';

    const isTradable = currentPhase === 'trading';

    for (const teamId in teams) {
        const team = teams[teamId];
        const shares = myPortfolio[teamId] || 0;
        const value = shares * team.price;

        const div = document.createElement('div');
        div.className = 'bg-gray-700 p-3 rounded-lg flex flex-col justify-between items-center border border-gray-600 relative overflow-hidden';
        
        let tradeButtonHTML;
        if (isTradable) {
            tradeButtonHTML = `<button onclick="openTradeModal('${teamId}')" class="w-full bg-yellow-600 hover:bg-yellow-500 py-2 rounded text-sm font-semibold transition">💹 매매하기 (매수/매도)</button>`;
        } else if (currentPhase === 'ended') {
            tradeButtonHTML = `<div class="w-full text-center text-gray-500 text-sm py-2">🏁 거래 종료</div>`;
        } else {
            tradeButtonHTML = `<div class="w-full text-center text-gray-500 text-sm py-2">⏸ 매매 대기 중</div>`;
        }

        div.innerHTML = `
            <div class="w-full flex justify-between items-center mb-2">
                <div class="font-bold text-lg">${team.name} <span class="text-xs bg-gray-600 px-2 py-1 rounded text-gray-300 ml-1 font-normal">${shares}주</span></div>
                <div class="text-right">
                    <div class="font-mono text-yellow-300 font-bold text-lg" id="stu-price-${teamId}">${team.price.toLocaleString()}원</div>
                    <div class="text-xs text-gray-400">평가액: ${value.toLocaleString()}원</div>
                </div>
            </div>
            ${tradeButtonHTML}
        `;
        list.appendChild(div);
    }
}

// ─── 투표 ─────────────────────────────────────────────────────────────
window.vote = function(type) {
    if (!currentPresentation || currentPhase !== 'presentation') return;
    const reasonInput = document.getElementById('voteReason');
    const reason = reasonInput.value.trim();
    socket.emit('vote', { roomCode, teamId: currentPresentation, type, reason });
    reasonInput.value = '';
    const btn = event.target;
    btn.classList.add('opacity-50');
    setTimeout(() => btn.classList.remove('opacity-50'), 5000);
};

// ─── 채팅 전송 (발표 중에만 허용) ──────────────────────────────────────
document.getElementById('voteReasonForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (currentPhase !== 'presentation' || !currentPresentation) return;
    const reasonInput = document.getElementById('voteReason');
    const reason = reasonInput.value.trim();
    if (reason) {
        socket.emit('chatMessage', { roomCode, message: reason });
        reasonInput.value = '';
    }
});

// ─── 소켓 이벤트: 발표 상태 변경 ────────────────────────────────────
socket.on('presentationStatusChanged', ({ teamId, status, phase }) => {
    currentPresentation = status === 'start' ? teamId : null;
    currentPhase = phase || currentPhase;
    updatePhaseUI(currentPhase, currentPresentation);
});

// ─── 소켓 이벤트: 게임 단계 변경 ────────────────────────────────────
socket.on('phaseChanged', ({ phase }) => {
    currentPhase = phase;
    currentPresentation = null;
    updatePhaseUI(currentPhase, null);
});

// ─── 소켓 이벤트: 주가 업데이트 ────────────────────────────────────
socket.on('priceUpdated', ({ teamId, price, history }) => {
    const oldPrice = teams[teamId].price;
    teams[teamId].price = price;
    teams[teamId].history = history;

    const priceEl = document.getElementById(`stu-price-${teamId}`);
    if (priceEl) {
        priceEl.innerText = `${price.toLocaleString()}원`;
        priceEl.classList.remove('heartbeat', 'text-green-400', 'text-red-400', 'text-yellow-300');
        void priceEl.offsetWidth;
        if (price > oldPrice) { priceEl.classList.add('heartbeat', 'text-green-400'); }
        else if (price < oldPrice) { priceEl.classList.add('heartbeat', 'text-red-400'); }
        else { priceEl.classList.add('text-yellow-300'); }
        setTimeout(() => {
            if (priceEl) {
                priceEl.classList.remove('text-green-400', 'text-red-400');
                priceEl.classList.add('text-yellow-300');
            }
        }, 1000);
    }

    const modal = document.getElementById('tradeModal');
    if (modal.classList.contains('hidden')) {
        renderPortfolio();
    } else if (selectedTeamIdForTrade === teamId) {
        document.getElementById('modalPrice').innerText = price.toLocaleString();
        updateModalTotal();
    }
});

socket.on('voteError', ({ message }) => {
    const msgEl = document.getElementById('voteMessage');
    msgEl.innerText = message;
    msgEl.classList.remove('hidden');
    setTimeout(() => msgEl.classList.add('hidden'), 3000);
});

// ─── 매매 모달 ────────────────────────────────────────────────────────
window.openTradeModal = function(teamId) {
    // 매매 단계가 아닐 때 차단
    if (currentPhase !== 'trading') return;
    selectedTeamIdForTrade = teamId;
    const team = teams[teamId];
    document.getElementById('modalTitle').innerText = `${team.name} 매매`;
    document.getElementById('modalPrice').innerText = team.price.toLocaleString();
    document.getElementById('tradeAmount').value = 1;
    updateModalTotal();
    document.getElementById('tradeModal').classList.remove('hidden');
    document.getElementById('tradeModal').classList.add('flex');
};

window.closeModal = function() {
    document.getElementById('tradeModal').classList.add('hidden');
    document.getElementById('tradeModal').classList.remove('flex');
    selectedTeamIdForTrade = null;
    renderPortfolio();
};

function updateModalTotal() {
    if (!selectedTeamIdForTrade) return;
    const amount = parseInt(document.getElementById('tradeAmount').value) || 0;
    const price = teams[selectedTeamIdForTrade].price;
    document.getElementById('modalTotal').innerText = (amount * price).toLocaleString();
}

document.getElementById('tradeAmount').addEventListener('input', updateModalTotal);

window.setTradeAmount = function(qty) {
    document.getElementById('tradeAmount').value = qty;
    updateModalTotal();
};

function executeTrade(action) {
    if (!selectedTeamIdForTrade) return;
    const amount = parseInt(document.getElementById('tradeAmount').value);
    if (isNaN(amount) || amount <= 0) { alert('올바른 수량을 입력하세요.'); return; }

    socket.emit('trade', { roomCode, teamId: selectedTeamIdForTrade, action, amount }, (response) => {
        if (response.success) {
            myCash = response.cash;
            myPortfolio = response.portfolio;
            updateCashUI();
            closeModal();
        } else {
            alert(response.message);
        }
    });
}

document.getElementById('buyBtn').addEventListener('click', () => executeTrade('buy'));
document.getElementById('sellBtn').addEventListener('click', () => executeTrade('sell'));
