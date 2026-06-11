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
const colors = [
    '#F87171', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', 
    '#F472B6', '#38BDF8', '#4ADE80', '#FB923C', '#C084FC'
];

// 차트 초기화 함수
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
        data: {
            labels: ['시작'], // 데이터 길이에 맞춰 라벨 동적 업데이트 필요
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    display: false // X축 라벨 숨김 (틱 단위)
                },
                y: {
                    beginAtZero: false,
                    grid: { color: '#374151' },
                    ticks: { color: '#D1D5DB' }
                }
            },
            plugins: {
                legend: { labels: { color: '#D1D5DB' } }
            },
            animation: {
                duration: 500
            }
        }
    });
}

// 차트 데이터 갱신
function updateChart(teamId, price, history) {
    if (!chart) return;
    const dataset = chart.data.datasets.find(ds => ds.label === roomData.teams[teamId].name);
    if (dataset) {
        dataset.data = history;
        // 가장 긴 history에 맞춰 x축 라벨 증가
        const maxLength = Math.max(...chart.data.datasets.map(ds => ds.data.length));
        if (chart.data.labels.length < maxLength) {
            chart.data.labels.push('');
        }
        chart.update();
    }
}

// 모둠 테이블 렌더링
function renderTeams() {
    const tbody = document.getElementById('teamListBody');
    tbody.innerHTML = '';
    for (const teamId in roomData.teams) {
        const team = roomData.teams[teamId];
        const isPresenting = roomData.currentPresentation === teamId;
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-700 hover:bg-gray-700 transition';
        tr.id = `row-${teamId}`;
        
        tr.innerHTML = `
            <td class="p-3 font-semibold">${team.name}</td>
            <td class="p-3 font-mono font-bold text-yellow-300" id="price-${teamId}">${team.price.toLocaleString()}원</td>
            <td class="p-3 text-green-400 font-bold" id="up-${teamId}">${team.votes.up}</td>
            <td class="p-3 text-red-400 font-bold" id="down-${teamId}">${team.votes.down}</td>
            <td class="p-3">
                ${isPresenting 
                    ? `<button onclick="setPresentation('${teamId}', 'end')" class="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm font-bold w-24">종료</button>`
                    : `<button onclick="setPresentation('${teamId}', 'start')" class="bg-green-500 hover:bg-green-600 px-3 py-1 rounded text-sm font-bold w-24 ${roomData.currentPresentation ? 'opacity-50 cursor-not-allowed' : ''}" ${roomData.currentPresentation ? 'disabled' : ''}>발표 시작</button>`
                }
            </td>
        `;
        tbody.appendChild(tr);
    }
}

// 학생 리스트 렌더링
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

// 서버에 현재 상태 요청
socket.emit('requestRoomState', roomCode, (response) => {
    if (response.success) {
        roomData = response.roomData;
        initChart(roomData.teams);
        renderTeams();
        renderStudents();
        roomData.chats.forEach(chat => appendChat(chat));
    } else {
        alert('방 정보를 불러올 수 없습니다. 다시 접속해주세요.');
        window.location.href = '/';
    }
});

// 발표 제어 요청
window.setPresentation = function(teamId, status) {
    socket.emit('setPresentation', { roomCode, teamId, status });
};

// 소켓 이벤트 리스너
socket.on('studentJoined', (student) => {
    roomData.students[student.socketId] = student;
    renderStudents();
});

socket.on('studentLeft', (socketId) => {
    if(roomData.students[socketId]) {
        // 완전 삭제할지 여부는 정책에 따라 (현재는 정보 유지를 위해 삭제 안함)
        // renderStudents();
    }
});

socket.on('presentationStatusChanged', ({ teamId, status }) => {
    if (status === 'start') {
        roomData.currentPresentation = teamId;
    } else {
        roomData.currentPresentation = null;
    }
    renderTeams();
});

socket.on('priceUpdated', ({ teamId, price, history, votes }) => {
    const oldPrice = roomData.teams[teamId].price;
    roomData.teams[teamId].price = price;
    roomData.teams[teamId].history = history;
    roomData.teams[teamId].votes = votes;

    // 테이블 UI 업데이트
    const priceTd = document.getElementById(`price-${teamId}`);
    if (priceTd) {
        priceTd.innerText = `${price.toLocaleString()}원`;
        // 시각적 피드백
        priceTd.classList.remove('flash-up', 'flash-down');
        void priceTd.offsetWidth; // trigger reflow
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
    roomData.chats.push(chatMsg);
    appendChat(chatMsg);
});

function appendChat(chat) {
    const chatBox = document.getElementById('chatBox');
    const div = document.createElement('div');
    
    let icon = '💬';
    let textClass = 'text-gray-300';
    if (chat.type === 'up') { icon = '👍'; textClass = 'text-green-300'; }
    if (chat.type === 'down') { icon = '👎'; textClass = 'text-red-300'; }

    let teamName = chat.teamId && roomData.teams[chat.teamId] ? `[${roomData.teams[chat.teamId].name}] ` : '';

    div.className = 'text-sm border-b border-gray-700 pb-1';
    div.innerHTML = `<span class="font-bold text-gray-400">${chat.sender}</span>: ${teamName}<span class="${textClass}">${icon} ${chat.message}</span>`;
    
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 엑셀 내보내기 기능
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if(!roomData) return;

    // 1. 학생별 최종 자산 및 순위 정리
    const studentsArray = Object.values(roomData.students).map(s => {
        // 최종 자산 = 현금 + (보유 주식수 * 각 모둠 최종 가격)
        let totalAsset = s.cash;
        for (const tId in s.portfolio) {
            totalAsset += s.portfolio[tId] * roomData.teams[tId].price;
        }
        return {
            '학번': s.studentId,
            '이름': s.studentName,
            '남은 현금': s.cash,
            '최종 총 자산': totalAsset
        };
    });

    // 총 자산 내림차순 정렬
    studentsArray.sort((a, b) => b['최종 총 자산'] - a['최종 총 자산']);
    
    // 순위 부여
    studentsArray.forEach((s, idx) => s['순위'] = idx + 1);

    // 2. 모둠별 최종 주가 및 상승률 정리
    const teamsArray = Object.values(roomData.teams).map(t => {
        const startPrice = t.history[0];
        const endPrice = t.price;
        const rate = ((endPrice - startPrice) / startPrice * 100).toFixed(2);
        return {
            '모둠명': t.name,
            '초기 주가': startPrice,
            '최종 주가': endPrice,
            '상승률(%)': rate + '%',
            '긍정 투표수': t.votes.up,
            '부정 투표수': t.votes.down
        };
    });

    // 워크북 생성
    const wb = XLSX.utils.book_new();
    
    const wsStudents = XLSX.utils.json_to_sheet(studentsArray);
    XLSX.utils.book_append_sheet(wb, wsStudents, "학생별 최종 순위");
    
    const wsTeams = XLSX.utils.json_to_sheet(teamsArray);
    XLSX.utils.book_append_sheet(wb, wsTeams, "모둠별 최종 결과");

    // 다운로드
    XLSX.writeFile(wb, `모의투자_결과_${roomCode}.xlsx`);
});
