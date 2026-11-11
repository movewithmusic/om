#!/bin/sh
# 每次更新網站後執行，讓大家的瀏覽器抓到新版（避免舊版快取）
V=$(date +%Y%m%d%H%M)
sed -i "s#style.css?v=[0-9]*#style.css?v=$V#; s#app.js?v=[0-9]*#app.js?v=$V#" index.html
