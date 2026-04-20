# Desktop Agent — Makefile
# Memudahkan pengelolaan agent di Windows/Linux

.PHONY: setup register start stop restart logs status clean

# 1. Setup awal: Install dependensi
setup:
	npm install

# 2. Registrasi: Daftarkan device ke server
register:
	node register.js

# 3. Running: Jalankan di background menggunakan PM2
start:
	pm2 start agent.js --name device-monitor --update-env

# 4. Stop: Berhentikan proses PM2
stop:
	pm2 stop device-monitor

# 5. Restart: Restart proses (gunakan ini setelah update kode/konfigurasi)
restart:
	pm2 restart device-monitor --update-env

# 6. Persistence: Agar otomatis jalan saat Windows dinyalakan (boot)
# Note: Memerlukan npminstall -g pm2-windows-startup (hanya sekali saja)
enable-boot:
	pm2 save
	@echo "Untuk otomatis jalan saat boot, pastikan Anda sudah menjalankan: npm install -g pm2-windows-startup && pm2-startup install"

# 7. Logs: Lihat log aktivitas secara real-time
logs:
	pm2 logs device-monitor

# 7. Status: Lihat status proses PM2
status:
	pm2 status

# 8. Clean: Hapus dependensi jika diperlukan
clean:
	rm -rf node_modules package-lock.json
