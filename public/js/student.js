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
let selectedTeamIdForTrade = null;

// 방 재접속 처리
socket.emit('joinRoom', { roomCode, studentId, studentName }, (response) => {
    if (response.success) {
        myCash = response.studentData.cash;
        myPortfolio = response.studentData.portfolio;
        teams = response.roomData.teams;
        currentPresentation = response.roomData.currentPresentation;
        
        updateCashUI();
        updatePresentationUI();
        renderPortfolio();
    } else {
        alert(response.message);
        window.location.href = '/';
    }
});

function updateCashUI() {
    document.getElementById('myCash').innerText = `${myCash.toLocaleString()}원`;
}

function updatePresentationUI() {
    const section = document.getElementById('presentationSection');
    const nameSpan = document.getElementById('currentTeamName');
    
    if (currentPresentation) {
        section.classList.remove('hidden');
        nameSpan.innerText = teams[currentPresentation].name;
    } else {
        section.classList.add('hidden');
    }
}

function renderPortfolio() {
    const list = document.getElementById('portfolioList');
    list.innerHTML = '';

    for (const teamId in teams) {
        const team = teams[teamId];
        const shares = myPortfolio[teamId] || 0;
        const value = shares * team.price;
        const isPresenting = currentPresentation === teamId;

        const div = document.createElement('div');
        div.className = 'bg-gray-700 p-3 rounded-lg flex flex-col justify-between items-center border border-gray-600 relative overflow-hidden';
        
        div.innerHTML = `
            <div class="w-full flex justify-between items-center mb-2">
                <div class="font-bold text-lg">${team.name} <span class="text-xs bg-gray-600 px-2 py-1 rounded text-gray-300 ml-1 font-normal">${shares}주</span></div>
                <div class="text-right">
                    <div class="font-mono text-yellow-300 font-bold text-lg" id="stu-price-${teamId}">${team.price.toLocaleString()}원</div>
                    <div class="text-xs text-gray-400">평가액: ${value.toLocaleString()}원</div>
                </div>
            </div>
            <button onclick="openTradeModal('${teamId}')" class="w-full bg-gray-600 hover:bg-gray-500 py-2 rounded text-sm font-semibold transition disabled:opacity-50" ${isPresenting ? 'disabled' : ''}>
                ${isPresenting ? '발표 진행 중 (매매 불가)' : '매매하기 (매수/매도)'}
            </button>
        `;
        list.appendChild(div);
    }
}

// 투표 및 이유 전송
window.vote = function(type) {
    if (!currentPresentation) return;
    
    const reasonInput = document.getElementById('voteReason');
    const reason = reasonInput.value.trim();
    
    socket.emit('vote', { roomCode, teamId: currentPresentation, type, reason });
    
    reasonInput.value = ''; // 입력창 초기화
    
    // 버튼 시각적 피드백
    const btn = event.target;
    btn.classList.add('opacity-50');
    setTimeout(() => btn.classList.remove('opacity-50'), 5000); // 5초간 약간 흐리게 (쿨타임 표시)
};

// 단순 채팅 전송
document.getElementById('voteReasonForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const reasonInput = document.getElementById('voteReason');
    const reason = reasonInput.value.trim();
    
    if (reason && !currentPresentation) {
        socket.emit('chatMessage', { roomCode, message: reason });
        reasonInput.value = '';
    } else if (reason && currentPresentation) {
        // 투표 없이 이유만 보낼 때 중립 코멘트로 처리 (서버에서 chatMessage로 받음)
        socket.emit('chatMessage', { roomCode, message: reason });
        reasonInput.value = '';
    }
});

// 서버로부터 상태 업데이트 수신
socket.on('presentationStatusChanged', ({ teamId, status }) => {
    if (status === 'start') {
        currentPresentation = teamId;
    } else {
        currentPresentation = null;
    }
    updatePresentationUI();
    renderPortfolio(); // 발표 상태에 따라 매매 버튼 활성/비활성화 갱신
});

socket.on('priceUpdated', ({ teamId, price, history }) => {
    const oldPrice = teams[teamId].price;
    teams[teamId].price = price;
    teams[teamId].history = history;

    // 특정 항목 UI 업데이트
    const priceEl = document.getElementById(`stu-price-${teamId}`);
    if (priceEl) {
        priceEl.innerText = `${price.toLocaleString()}원`;
        priceEl.classList.remove('heartbeat', 'text-green-400', 'text-red-400', 'text-yellow-300');
        void priceEl.offsetWidth;
        
        if (price > oldPrice) {
            priceEl.classList.add('heartbeat', 'text-green-400');
        } else if (price < oldPrice) {
            priceEl.classList.add('heartbeat', 'text-red-400');
        } else {
            priceEl.classList.add('text-yellow-300');
        }
        
        setTimeout(() => {
            if(priceEl) {
                priceEl.classList.remove('text-green-400', 'text-red-400');
                priceEl.classList.add('text-yellow-300');
            }
        }, 1000);
    }
    
    // 포트폴리오 평가액 등 전체 렌더링을 위해 모달 열려있지 않을 때만 전체 리렌더링 (깜빡임 방지)
    const modal = document.getElementById('tradeModal');
    if (modal.classList.contains('hidden')) {
        renderPortfolio();
    } else if (selectedTeamIdForTrade === teamId) {
        // 열려있는 모달의 가격도 갱신
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

// 매매 모달 관련 로직
window.openTradeModal = function(teamId) {
    if (currentPresentation === teamId) return; // 서버에서도 막지만 클라이언트에서도 차단
    
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
    renderPortfolio(); // 모달 닫을 때 최신 가격 반영하여 다시 그리기
};

function updateModalTotal() {
    if (!selectedTeamIdForTrade) return;
    const amount = parseInt(document.getElementById('tradeAmount').value) || 0;
    const price = teams[selectedTeamIdForTrade].price;
    document.getElementById('modalTotal').innerText = (amount * price).toLocaleString();
}

document.getElementById('tradeAmount').addEventListener('input', updateModalTotal);

window.setTradeAmount = function(qty) {
    const input = document.getElementById('tradeAmount');
    input.value = qty;
    updateModalTotal();
};

function executeTrade(action) {
    if (!selectedTeamIdForTrade) return;
    const amount = parseInt(document.getElementById('tradeAmount').value);
    
    if (isNaN(amount) || amount <= 0) {
        alert('올바른 수량을 입력하세요.');
        return;
    }

    socket.emit('trade', { roomCode, teamId: selectedTeamIdForTrade, action, amount }, (response) => {
        if (response.success) {
            myCash = response.cash;
            myPortfolio = response.portfolio;
            updateCashUI();
            closeModal();
            // renderPortfolio()는 priceUpdated나 closeModal()에서 처리됨
        } else {
            alert(response.message);
        }
    });
}

document.getElementById('buyBtn').addEventListener('click', () => executeTrade('buy'));
document.getElementById('sellBtn').addEventListener('click', () => executeTrade('sell'));
