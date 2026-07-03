document.addEventListener("DOMContentLoaded", () => {
    const sbdInput = document.getElementById("sbdInput");
    const searchBtn = document.getElementById("searchBtn");
    const loadingEl = document.getElementById("loading");
    const errorEl = document.getElementById("error");
    const resultsEl = document.getElementById("results");

    // Lắng nghe sự kiện Checkbox cho tổ hợp tự chọn (Tối đa 3 môn)
    const checkboxes = document.querySelectorAll('.subject-cb');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const checkedCount = document.querySelectorAll('.subject-cb:checked').length;
            if (checkedCount > 3) {
                cb.checked = false;
                alert("Bạn chỉ được chọn tối đa 3 môn để ghép tổ hợp tự chọn!");
                return;
            }

            // SỬA LỖI TỰ ĐỘNG TÍNH LẠI: Nếu kết quả tra cứu đang hiển thị, tự động gọi lại hàm tìm kiếm để cập nhật tổ hợp
            if (!resultsEl.classList.contains("hidden") && sbdInput.value.trim() !== "") {
                performSearch();
            }
        });
    });

    const renderCards = (containerId, data) => {
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        
        data.forEach((item, index) => {
            const card = document.createElement("div");
            card.className = `score-card ${item.isKhoi ? 'khoi' : ''}`;
            card.style.animationDelay = `${index * 0.05}s`;
            
            let html = `
                <div class="subject-name">${item.name}</div>
                <div class="score-value">${item.score}</div>
                <div class="rank-info"><span>Xếp hạng tỉnh:</span><strong>${item.rank_tinh}</strong></div>
                <div class="rank-info"><span>Top % tỉnh:</span><strong>${item.top_percent_tinh || 'N/A'}</strong></div>
                <div class="rank-info"><span>Xếp hạng QG:</span><strong>${item.rank_qg}</strong></div>
            `;
            if (item.equivalent_2025 !== null && item.equivalent_2025 !== undefined) {
                html += `<div class="equivalent">Điểm QĐ 2025: ${item.equivalent_2025}</div>`;
            }
            card.innerHTML = html;
            container.appendChild(card);
        });
    };
    
    const performSearch = async () => {
        const sbd = sbdInput.value.trim().replace(/\D/g, "").padStart(8, "0");
        if (!sbd || sbd === "00000000") return;
        
        // Thu thập danh sách môn tự chọn
        const selectedSubs = Array.from(document.querySelectorAll('.subject-cb:checked')).map(cb => cb.value);
        if (selectedSubs.length > 0 && selectedSubs.length !== 3) {
            alert("Vui lòng tích chọn đầy đủ 3 môn hoặc bỏ chọn hoàn toàn để tính tổ hợp.");
            return;
        }

        loadingEl.classList.remove("hidden");
        errorEl.classList.add("hidden");
        
        // CẬP NHẬT: Không ẩn toàn bộ bảng kết quả cũ để tránh màn hình bị giật nhấp nháy khi đổi môn, chỉ ẩn card tổ hợp cũ
        const customCard = document.getElementById('customComboCard');
        if (customCard) customCard.style.display = 'none';
        
        try {
            // Xây dựng URL API kèm theo tổ hợp môn tự chọn nếu có
            let url = `/api/lookup?sbd=${sbd}`;
            if (selectedSubs.length === 3) {
                url += `&customSubjects=${selectedSubs.join(',')}`;
            }

            const res = await fetch(url);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Không tìm thấy dữ liệu.");
            }
            
            const data = await res.json();
            document.getElementById("resSBD").textContent = data.sbd;
            document.getElementById("resTinh").textContent = data.ma_tinh;
            
            const monList = data.results.filter(r => !r.isKhoi);
            const khoiList = data.results.filter(r => r.isKhoi);
            
            renderCards("monContainer", monList);
            renderCards("khoiContainer", khoiList);
            
            // Xử lý hiển thị kết quả tổ hợp tự chọn của người dùng và tính % Quốc gia
            if (data.customResult && customCard) {
                customCard.style.display = 'block';
                document.getElementById('lblCustomName').innerText = data.customResult.name;
                document.getElementById('lblCustomScore').innerText = data.customResult.score;
                document.getElementById('lblCustomRankProv').innerText = data.customResult.rank_tinh;
                document.getElementById('lblCustomPercentProv').innerText = data.customResult.top_percent_tinh;
                
                // CẬP NHẬT MỚI: Thêm xếp hạng phần trăm so với Quốc gia dựa trên dữ liệu backend (mặc định lấy theo top_percent_qg hoặc tự quy đổi)
                const lblCustomPercentNational = document.getElementById('lblCustomPercentNational');
                if (lblCustomPercentNational) {
                    lblCustomPercentNational.innerText = data.customResult.top_percent_qg || data.customResult.top_percent_tinh || 'N/A';
                }
            } else if (selectedSubs.length === 3 && customCard) {
                // Trường hợp thí sinh thiếu môn trong bộ 3 môn đã chọn
                customCard.style.display = 'block';
                document.getElementById('lblCustomName').innerText = selectedSubs.join(' + ').toUpperCase();
                document.getElementById('lblCustomScore').innerText = "N/A";
                document.getElementById('lblCustomRankProv').innerText = "Không đủ môn thi";
                document.getElementById('lblCustomPercentProv').innerText = "N/A";
                
                const lblCustomPercentNational = document.getElementById('lblCustomPercentNational');
                if (lblCustomPercentNational) lblCustomPercentNational.innerText = "N/A";
            }
            
            loadingEl.classList.add("hidden");
            resultsEl.classList.remove("hidden");
        } catch (e) {
            loadingEl.classList.add("hidden");
            errorEl.textContent = e.message;
            errorEl.classList.remove("hidden");
        }
    };
    
    searchBtn.addEventListener("click", performSearch);
    sbdInput.addEventListener("keypress", (e) => { if (e.key === "Enter") performSearch(); });

    // Cấu hình tính toán HSA
    const hsaType = document.getElementById("hsaType");
    const hsaScore = document.getElementById("hsaScore");
    const hsaTarget = document.getElementById("hsaTarget");
    const hsaConvertBtn = document.getElementById("hsaConvertBtn");
    const hsaError = document.getElementById("hsaError");
    const hsaResult = document.getElementById("hsaResult");

    const performHsaConvert = async () => {
        const score = hsaScore.value.trim();
        if (!score) return;
        
        hsaError.classList.add("hidden");
        hsaResult.classList.add("hidden");
        
        try {
            const res = await fetch(`/api/convert-hsa?type=${hsaType.value}&score=${score}&targetCol=${hsaTarget.value}`);
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Lỗi xử lý hệ thống.");
            }
            const data = await res.json();
            const targetText = hsaTarget.options[hsaTarget.selectedIndex].text;
            
            hsaResult.innerHTML = `
                <div class="hsa-result-card">
                    <h3>Mức điểm THPT tương đương (${targetText})</h3>
                    <div class="score-value">${data.equivalent}</div>
                    <p>Bách phân vị HSA: <strong>${data.pct}%</strong></p>
                </div>
            `;
            hsaResult.classList.remove("hidden");
        } catch(e) {
            hsaError.textContent = e.message;
            hsaError.classList.remove("hidden");
        }
    };
    
    hsaConvertBtn.addEventListener("click", performHsaConvert);
    hsaScore.addEventListener("keypress", (e) => { if (e.key === "Enter") performHsaConvert(); });
});
