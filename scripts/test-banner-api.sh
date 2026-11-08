#!/bin/bash
# Test API popup banner AGSI: login admin → PUT banner → GET settings → cek gambar
BASE="http://localhost:3000"
JAR="/tmp/agsi-banner-test.jar"
rm -f "$JAR"

echo "===== 1. LOGIN ADMIN ====="
curl -s -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@agsi.test","password":"admin123"}' | head -c 200
echo; echo

echo "===== 2. PUT banner (aktif + judul + teks, tanpa gambar dulu) ====="
curl -s -b "$JAR" -X PUT "$BASE/api/settings" \
  -H "Content-Type: application/json" \
  -d '{"bannerEnabled":true,"bannerTitle":"Promo Uji Coba","bannerText":"Test pesan banner","bannerTouch":true}' | python3 -m json.tool
echo

echo "===== 3. PUT gambar banner (data URL) ====="
B64=$(base64 -w0 /home/z/my-project/download/test-banner-promo.jpg)
python3 - "$B64" <<'EOF' > /tmp/banner-payload.json
import json, sys
b64 = sys.argv[1]
print(json.dumps({"bannerImageData": f"data:image/jpeg;base64,{b64}"}))
EOF
curl -s -b "$JAR" -X PUT "$BASE/api/settings" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/banner-payload.json | python3 -m json.tool
echo

echo "===== 4. GET settings (publik — tanpa login) ====="
curl -s "$BASE/api/settings" | python3 -m json.tool
echo

echo "===== 5. GET gambar banner ====="
curl -s -o /tmp/banner-fetch.jpg -w "HTTP %{http_code} | type %{content_type} | size %{size_download}\n" "$BASE/api/settings/banner/image?v=test"
python3 -c "from PIL import Image; im=Image.open('/tmp/banner-fetch.jpg'); print('gambar valid:', im.size, im.format)"

echo "===== 6. PUT tanpa login (harus 403) ====="
curl -s -X PUT "$BASE/api/settings" -H "Content-Type: application/json" \
  -d '{"bannerEnabled":false}' -w "\nHTTP %{http_code}\n"

echo "===== 7. PUT saklar deliveryEnabled tetap bekerja (regresi) ====="
curl -s -b "$JAR" -X PUT "$BASE/api/settings" -H "Content-Type: application/json" \
  -d '{"deliveryEnabled":true}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('deliveryEnabled:', d['settings']['deliveryEnabled'], '| bannerEnabled:', d['banner']['bannerEnabled'])"
