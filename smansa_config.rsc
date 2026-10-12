# ========================================================
# SCRIPT KONFIGURASI OTOMATIS MIKROTIK SMANSA (hEX E50UG)
# Dihasilkan otomatis oleh Aplikasi Setting Mikrotik SMANSA
# Tanggal: 12/10/2026, 08.26.08
# ========================================================

# 1. Identitas Router
/system identity set name="MikroTik-SMANSA"

# 2. Bridge Port LAN (Ether 2 ke Switch Hub TL-SG1016D)
:if ([:len [/interface bridge find name=bridge-LAN]] = 0) do={
  /interface bridge add name=bridge-LAN comment="Bridge Switch Hub SMANSA"
  /interface bridge port add bridge=bridge-LAN interface=ether2 comment="Ke Switch Hub TL-SG1016D"
  /interface bridge port add bridge=bridge-LAN interface=ether3
  /interface bridge port add bridge=bridge-LAN interface=ether4
  /interface bridge port add bridge=bridge-LAN interface=ether5
}

# 3. Koneksi Internet Indibiz 300 Mbps (Ether 1)
:if ([:len [/ip dhcp-client find interface=ether1]] = 0) do={
  /ip dhcp-client add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="Indibiz 300 Mbps"
}

# 4. IP Gateway & Firewall NAT
:if ([:len [/ip address find address="192.168.88.1/24"]] = 0) do={
  /ip address add address=192.168.88.1/24 interface=bridge-LAN comment="Gateway LAN SMANSA"
}
/ip dns set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8
:if ([:len [/ip firewall nat find comment="NAT Internet Indibiz"]] = 0) do={
  /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="NAT Internet Indibiz"
}

# 5. Anti-Konflik IP: Kunci IP Statis untuk 6 Router WiFi
:if ([:len [/ip dhcp-server lease find address="192.168.88.11"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.11 comment="WiFi_1__Ruang_Guru___TU_"
}
:if ([:len [/ip dhcp-server lease find address="192.168.88.12"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.12 comment="WiFi_2__Lab_Komputer_"
}
:if ([:len [/ip dhcp-server lease find address="192.168.88.13"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.13 comment="WiFi_3__Perpustakaan_"
}
:if ([:len [/ip dhcp-server lease find address="192.168.88.14"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.14 comment="WiFi_4__Kelas_X___XI_"
}
:if ([:len [/ip dhcp-server lease find address="192.168.88.15"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.15 comment="WiFi_5__Kelas_XII_"
}
:if ([:len [/ip dhcp-server lease find address="192.168.88.16"]] = 0) do={
  /ip dhcp-server lease add address=192.168.88.16 comment="WiFi_6__Tamu___Lapangan_"
}

# 6. Simple Queues (Jatah Bandwidth WiFi 1 s/d WiFi 6)
:if ([:len [/queue simple find target="192.168.88.11/32"]] = 0) do={
  /queue simple add name="WiFi_1__Ruang_Guru___TU_" target=192.168.88.11/32 max-limit=20M/60M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.11/32"] max-limit=20M/60M disabled=no
}
:if ([:len [/queue simple find target="192.168.88.12/32"]] = 0) do={
  /queue simple add name="WiFi_2__Lab_Komputer_" target=192.168.88.12/32 max-limit=25M/70M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.12/32"] max-limit=25M/70M disabled=no
}
:if ([:len [/queue simple find target="192.168.88.13/32"]] = 0) do={
  /queue simple add name="WiFi_3__Perpustakaan_" target=192.168.88.13/32 max-limit=10M/30M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.13/32"] max-limit=10M/30M disabled=no
}
:if ([:len [/queue simple find target="192.168.88.14/32"]] = 0) do={
  /queue simple add name="WiFi_4__Kelas_X___XI_" target=192.168.88.14/32 max-limit=15M/40M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.14/32"] max-limit=15M/40M disabled=no
}
:if ([:len [/queue simple find target="192.168.88.15/32"]] = 0) do={
  /queue simple add name="WiFi_5__Kelas_XII_" target=192.168.88.15/32 max-limit=15M/40M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.15/32"] max-limit=15M/40M disabled=no
}
:if ([:len [/queue simple find target="192.168.88.16/32"]] = 0) do={
  /queue simple add name="WiFi_6__Tamu___Lapangan_" target=192.168.88.16/32 max-limit=10M/20M disabled=no comment="SMANSA Bandwidth"
} else={
  /queue simple set [find target="192.168.88.16/32"] max-limit=10M/20M disabled=no
}

# 7. Firewall Filter: Drop Perangkat Terblokir (Blacklist)
:if ([:len [/ip firewall filter find comment="DROP_BLOCKED_CLIENTS"]] = 0) do={
  /ip firewall filter add chain=forward src-address-list=BLOCKED_CLIENTS action=drop comment="DROP_BLOCKED_CLIENTS"
}

