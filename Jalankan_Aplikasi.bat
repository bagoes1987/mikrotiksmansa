@echo off
title Mikrotik SMANSA - Sistem Otomatis Online
color 0A
cls
echo ===================================================================
echo               MIKROTIK SMANSA (AUTO ONLINE - ZERO UPLOAD)
echo ===================================================================
echo [*] Memulai Server Lokal & Cloudflare Tunnel...
echo [*] Anda TIDAK PERLU upload ke cPanel / hosting mana pun!
echo [*] Kapanpun Anda minta update, asisten AI langsung update otomatis.
echo ===================================================================

start /B node server.js > nul 2>&1
start /B cloudflared.exe tunnel --url http://localhost:3000 > tunnel.log 2>&1

timeout /t 3 > nul

echo [*] Membuka Dashboard...
start http://localhost:3000

echo ===================================================================
echo [OK] APLIKASI SUDAH ONLINE DAN AKTIF!
echo      - Akses Komputer: http://localhost:3000
echo      - Akses HP: Buka tombol "Akses Online HP" di dalam Dashboard
echo ===================================================================
pause

