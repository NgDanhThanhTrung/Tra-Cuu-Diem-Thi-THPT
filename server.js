const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Phục vụ giao diện tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cấu hình link GitHub Raw gốc của bạn
const BASE_RAW_URL = "https://raw.githubusercontent.com/NgDanhThanhTrung/Tra-Cuu-Diem-Thi-THPT/refs/heads/main/data";

const RAW_LINKS = {
    national2026: `${BASE_RAW_URL}/national_2026.json`,
    national2025: `${BASE_RAW_URL}/national_2025.json`,
    hsaData: `${BASE_RAW_URL}/hsa_data.json`,
    provincesBaseUrl: `${BASE_RAW_URL}/provinces`
};

// Hàm tải dữ liệu Raw từ xa, tự động hủy sau 8 giây nếu phản hồi chậm
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

// Thuật toán xử lý số liệu điểm số
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

// [API] Tra cứu điểm số báo danh
app.get('/api/lookup', async (req, res) => {
    const { sbd } = req.query;
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
    const responseData = { sbd, ma_tinh, results: [] };

    const displayNames = [
        "Toán", "Ngữ văn", "Vật lý", "Hóa học", "Sinh học", "Lịch sử", "Địa lý", "Ngoại ngữ",
        "Khối A00", "Khối A01", "Khối B00", "Khối C00", "Khối D01", "Khối A02", "Khối C01", "Khối D07"
    ];

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
            equivalent_2025: equivalent_2025 !== null ? equivalent_2025.toFixed(2) : null
        });
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

// Chuyển hướng mọi request khác về trang chủ index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Ứng dụng đang hoạt động mượt mà tại cổng: ${PORT}`));
