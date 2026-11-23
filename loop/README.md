# Cheese Thief — Vòng lặp cải thiện 10 chu kỳ

Mỗi chu kỳ gồm đúng 6 bước (chỉ đạo của Hoàng, 2026-11-23):
1. **Báo cáo** — viết/cập nhật báo cáo QA cho trạng thái production hiện tại.
2. **Tự test lại** — chạy toàn bộ test battery + ít nhất 1 lượt self-play bằng trình duyệt thật.
3. **Liệt kê lỗi** — danh sách bug P0/P1/P2; sửa P0/P1 trước khi thêm tính năng.
4. **Phân tích thị trường** — nghiên cứu game suy luận xã hội/party game đang chạy tốt (tính năng, UX, giữ chân người chơi).
5. **Thêm logic + viết prompt** — thiết kế 1 cải tiến, ghi thành file `PROMPT-CYCLE-NN.md`.
6. **Cải thiện theo prompt** — triển khai đúng prompt đó, test xanh mới deploy, xác minh bundle live.

File mỗi chu kỳ: `CYCLE-NN.md` (báo cáo + lỗi + thị trường + logic đã thêm + kết quả).
Nhật ký tổng: `LOOP-LOG.md`. Tổng kết cuối: `FINAL-REPORT.md`.
