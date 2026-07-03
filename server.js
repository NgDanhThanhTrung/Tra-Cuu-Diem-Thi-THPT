const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const BASE_RAW_URL = "https://raw.githubusercontent.com/NgDanhThanhTrung/Tra-Cuu-Diem-Thi-THPT/refs/heads/main/data";

const RAW_LINKS = {
    national2026: `${BASE_RAW_URL}/national_2026.json`,
    national2025: `${BASE_RAW_URL}/national_2025.json`,
    hsaData: `${BASE_RAW_URL}/hsa_data.json`,
    provincesBaseUrl: `${BASE_RAW_URL}/provinces`
};

const displayNames = [
    "Toán", "Ngữ văn", "Vật lý", "Hóa học", "Sinh học", "Lịch sử", "Địa lý", "Ngoại ngữ",
    "Khối A00", "Khối A01", "Khối B00", "Khối C00", "Khối D01", "Khối A02", "Khối C01", "Khối D07"
];

// Mapping tên gốc trong file JSON (cols) với tên hiển thị tiếng Việt
const colMapping = {
    "toan": "Toán", "ngu_van": "Ngữ văn", "vat_ly": "Vật lý", "hoa_hoc": "Hóa học",
    "sinh_hoc": "Sinh học", "lich_su": "Lịch sử", "dia_ly": "Địa lý", "ngoai_ngu": "Ngoại ngữ"
};

async function fetchRawData(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error(`Lỗi kết nối dữ liệu: ${url}`, error.message);
        return null;
    }
}

const getSortedMap = (freqMap) => {
    if (!freqMap) return [];
    return Object.keys(freqMap)
        .map(k => ({ score: parseFloat(k), count: freqMap[k] }))
        .sort((a, b) => a.score - b.score);
};

const getRank = (sortedMap, myScore) => {
    let higherCount = 0;
    let total = 0;
    for (let e of sortedMap) {
        total += e.count;
        if (e.score > myScore) higherCount += e.count;
    }
    return { rank: higherCount + 1, total };
};

const getPercentile = (sortedMap, myScore) => {
    let lessOrEqual = 0;
    let total = 0;
    for (let e of sortedMap) {
        total += e.count;
        if (e.score <= myScore) lessOrEqual += e.count;
    }
    return total > 0 ? lessOrEqual / total : 0;
};

const getEquivalentScore = (sortedMap, percentile) => {
    let total = sortedMap.reduce((sum, e) => sum + e.count, 0);
    let targetIndex = percentile * total;
    let cumulative = 0;
    for (let e of sortedMap) {
        cumulative += e.count;
        if (cumulative >= targetIndex) return e.score;
    }
    return sortedMap.length > 0 ? sortedMap[sortedMap.length - 1].score : null;
};

// [API] Tra cứu điểm số báo danh & Tính tổ hợp 3 môn động
app.get('/api/lookup', async (req, res) => {
    const { sbd, customSubjects } = req.query; // customSubjects truyền lên dạng: 'toan,vat_ly,hoa_hoc'
    if (!sbd || sbd.length !== 8) {
        return res.status(400).json({ error: "Số báo danh phải đúng 8 chữ số." });
    }

    const ma_tinh = sbd.substring(0, 2);
    const provUrl = `${RAW_LINKS.provincesBaseUrl}/${ma_tinh}.json`;

    const [provData, national2026, national2025] = await Promise.all([
        fetchRawData(provUrl),
        fetchRawData(RAW_LINKS.national2026),
        fetchRawData(RAW_LINKS.national2025)
    ]);

    if (!provData || !provData.students || !provData.students[sbd]) {
        return res.status(404).json({ error: "Không tìm thấy SBD này hoặc link dữ liệu GitHub lỗi." });
    }

    const studentScores = provData.students[sbd];
    const cols = provData.cols;
    const responseData = { sbd, ma_tinh, results: [], customResult: null };

    // 1. Xử lý logic tra cứu mặc định sẵn có
    for (let i = 0; i < cols.length; i++) {
        const ten_cot = cols[i];
        const diem_ts = studentScores[i];
        if (diem_ts === null || diem_ts === undefined) continue;

        const provMap = getSortedMap(provData.stats?.[ten_cot] || {});
        const { rank: rank_tinh, total: tong_tinh } = getRank(provMap, diem_ts);

        const natMap26 = getSortedMap(national2026?.[ten_cot] || {});
        const { rank: rank_qg, total: tong_qg } = getRank(natMap26, diem_ts);

        let equivalent_2025 = null;
        const natMap25 = getSortedMap(national2025?.[ten_cot] || {});
        if (natMap25.length > 0 && natMap26.length > 0) {
            const pct = getPercentile(natMap26, diem_ts);
            equivalent_2025 = getEquivalentScore(natMap25, pct);
        }

        responseData.results.push({
            name: displayNames[i],
            score: diem_ts,
            isKhoi: displayNames[i].startsWith("Khối"),
            rank_tinh: `${rank_tinh.toLocaleString()}/${tong_tinh.toLocaleString()}`,
            rank_qg: `${rank_qg.toLocaleString()}/${tong_qg.toLocaleString()}`,
            top_percent_tinh: ((rank_tinh / tong_tinh) * 100).toFixed(2) + "%",
            top_percent_qg: ((rank_qg / tong_qg) * 100).toFixed(2) + "%",
            equivalent_2025: equivalent_2025 !== null ? equivalent_2025.toFixed(2) : null
        });
    }

    // 2. PHẦN MỚI: Tính toán tổ hợp 3 môn động theo Tỉnh
    const selectedSubs = customSubjects ? customSubjects.split(',') : [];
    if (selectedSubs.length === 3) {
        // Lấy index của 3 môn được chọn dựa theo mảng cols
        const subIndices = selectedSubs.map(sub => cols.indexOf(sub));

        // Kiểm tra xem thí sinh hiện tại có thi đủ 3 môn này không
        const isValidCandidate = subIndices.every(idx => idx !== -1 && studentScores[idx] !== null && studentScores[idx] !== undefined);

        if (isValidCandidate) {
            const myCustomScore = Math.round(subIndices.reduce((sum, idx) => sum + studentScores[idx], 0) * 100) / 100;

            let customHigherCount = 0;
            let customTotalInProvince = 0;

            // Quét qua toàn bộ thí sinh trong tỉnh để so thứ hạng (Real-time Compute)
            Object.keys(provData.students).forEach(keySbd => {
                const scores = provData.students[keySbd];
                // Kiểm tra thí sinh vòng lặp có thi đủ 3 môn đã chọn hay không
                const hasScores = subIndices.every(idx => scores[idx] !== null && scores[idx] !== undefined);
                if (hasScores) {
                    customTotalInProvince++;
                    const stSum = Math.round(subIndices.reduce((sum, idx) => sum + scores[idx], 0) * 100) / 100;
                    if (stSum > myCustomScore) {
                        customHigherCount++;
                    }
                }
            });

            const rank_tinh_custom = customHigherCount + 1;
            responseData.customResult = {
                name: selectedSubs.map(sub => colMapping[sub]).join(' + '),
                score: myCustomScore,
                rank_tinh: `${rank_tinh_custom.toLocaleString()}/${customTotalInProvince.toLocaleString()}`,
                top_percent_tinh: ((rank_tinh_custom / customTotalInProvince) * 100).toFixed(2) + "%"
            };
        }
    }

    res.json(responseData);
});

// [API] Quy đổi điểm HSA
app.get('/api/convert-hsa', async (req, res) => {
    const { type, score, targetCol } = req.query;

    const [hsaData, national2026] = await Promise.all([
        fetchRawData(RAW_LINKS.hsaData),
        fetchRawData(RAW_LINKS.national2026)
    ]);

    if (!hsaData || !hsaData[type] || hsaData[type][score] === undefined) {
        return res.status(400).json({ error: "Không có dữ liệu phù hợp với mức điểm HSA này." });
    }

    const pct = hsaData[type][score];
    const natMap26 = getSortedMap(national2026?.[targetCol] || {});
    
    if (natMap26.length === 0) {
        return res.status(400).json({ error: "Môn/Khối quy đổi không hợp lệ." });
    }

    const equivalent = getEquivalentScore(natMap26, pct / 100.0);
    res.json({ pct, equivalent: equivalent.toFixed(2) });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Ứng dụng đang hoạt động mượt mà tại cổng: ${PORT}`));
