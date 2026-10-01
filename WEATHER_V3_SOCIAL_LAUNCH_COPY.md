# WEATHER ENGINE V3 - SOCIAL LAUNCH COPY

Status: HOLD UNTIL PUBLIC UI IS LIVE
Prepared: 2026-10-01

## Publish gate

Do not publish this post until ALL are true:

- Weather V2 update set is finished and stable
- V3 UI branch has been rebased onto the final V2 commit
- Weather V3 contract reports `PUBLIC_READY`
- `public_ui_enabled = true`
- public-facing Weather page visibly contains the V3 Observation / Nowcast layer
- the public copy does not expose a source whose reuse/publication gate is still unresolved
- full QA/CI passes after the final UI integration

If radar remains rights-gated at launch, remove the radar-specific paragraph/example before publishing.

---

## FINAL POST - USE ONLY AFTER PUBLIC UI ENABLEMENT

🔔 𝐓𝐢𝐧𝐠 𝐭𝐢𝐧𝐠! 𝐓𝐡𝐨̂𝐧𝐠 𝐛𝐚́𝐨 𝐧𝐚̂𝐧𝐠 𝐜𝐚̂́𝐩 𝐖𝐞𝐚𝐭𝐡𝐞𝐫 𝐄𝐧𝐠𝐢𝐧𝐞 𝐕𝟑 - 𝐎𝐛𝐬𝐞𝐫𝐯𝐚𝐭𝐢𝐨𝐧 & 𝐍𝐨𝐰𝐜𝐚𝐬𝐭  
**Quan trắc & Dự báo cực ngắn chuyên biệt cho Phú Quốc.**

Đừng hỏi tại sao đang V1 mà tớ nhảy thẳng lên V3. Tại đang làm thì tớ phát hiện thêm nhiều thứ quá hay, thế là lôi cả bộ Weather ra nâng tiếp luôn. 😂

Điểm khác lớn nhất của V3 là Weather của Open Phu Quoc giờ có thêm khả năng **nhìn những gì đang thực sự diễn ra quanh Phú Quốc**, thay vì chỉ lấy đầu ra từ các mô hình dự báo.

V3 bổ sung một lớp Observation gồm radar thời tiết, ảnh vệ tinh Himawari, quan trắc mưa - gió - nhiệt độ và các nguồn quan trắc thực tế quanh đảo. Một số lớp khác như dữ liệu sét sẽ tiếp tục được bổ sung khi đủ điều kiện.

Weather Engine sẽ đối chiếu các nguồn này theo từng khu vực với mô hình dự báo, từ đó nhận biết những thay đổi đang xảy ra gần Phú Quốc và đưa ra dự báo cực ngắn.

Ví dụ, thay vì chỉ biết “chiều nay có khả năng mưa”, hệ thống có thể nhận ra:

- “Một vùng phản hồi mưa đang dịch về phía Tây Nam, chưa vào Phú Quốc.”
- “Vùng mây đối lưu đang tiến gần phía Đông đảo, cần theo dõi trong 30-60 phút tới.”

Khi đủ dữ liệu kiểm chứng, lớp Nowcast sẽ tiếp tục được mở rộng để nhận biết hướng di chuyển, xu hướng mạnh lên - yếu đi và khoảng thời gian cần lưu ý cho từng khu vực trên đảo.

Human Weather Layer được bổ sung từ V2 vẫn được giữ. Mục tiêu vẫn là **không quăng một đống số kỹ thuật vào mặt người dùng**.

Thay vì chỉ ghi “mưa 3 mm”, hệ thống sẽ cố gắng nói theo cách con người cần để ra quyết định hơn:

“An Thới đang có mưa rào nhẹ.”

Và khi dữ liệu đủ chắc:

“Có vùng mưa đang tiến gần An Thới, cần để ý trong khoảng 30 phút tới.”

Phần biển vẫn giữ logic đã xây ở V2: gió, gió giật, sóng và từng khung giờ được đọc cùng nhau thay vì nhìn một chỉ số riêng lẻ.

Phía sau V3 cũng có thêm một pipeline khá thú vị: hệ thống ghi lại những gì radar, vệ tinh và mô hình đã nhận định - rồi đối chiếu với những gì thực tế xảy ra.

Ví dụ hệ thống báo một vùng mưa có khả năng tới trong 30 phút, sau đó quan trắc thực tế sẽ trả lời: **có tới thiệt không, tới sớm hay trễ bao nhiêu phút, hay báo hụt**.

Những sai số đó sẽ được tích lũy để Weather Engine ngày càng hiểu điều kiện riêng của Phú Quốc tốt hơn, thay vì mặc định một mô hình nào đó lúc nào cũng đúng.

V3 đã bắt đầu được đưa lên giao diện Weather của Open Phu Quoc. Tớ vẫn sẽ mở dần từng lớp, ưu tiên những gì đủ dữ liệu và đủ chắc trước.

Nếu mọi người ở Phú Quốc thấy ngoài trời khác với hệ thống đang báo thì cứ nhắn tớ nhé. Dữ liệu thực địa như vậy rất có giá trị để tụi tớ kiểm tra lại hệ thống.

**Link:** https://openphuquoc.com/weather/ ☀️🌤️🌥️🌦️

---

## Launch-day final sanity check

Before posting, compare this copy with the actual public UI.

Delete any sentence about a layer that is not publicly enabled yet.

Do not claim:
- lightning by area unless the lightning layer is actually live and verified
- precise ETA unless the public contract has promoted ETA
- automatic model correction if the system is still only recording/evaluating errors
- marine V3 changes if production marine is still the V2 decision logic

Safe wording:
- “ghi lại sai số để đánh giá và hiệu chỉnh dần”
- “cần theo dõi trong 30-60 phút tới”
- “radar ghi nhận vùng phản hồi mưa”
- “V3 đã bắt đầu được đưa lên giao diện”
