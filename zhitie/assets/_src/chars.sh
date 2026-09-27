#!/bin/bash
# Сборка современных персонажей: raw (reskin.mjs) → dress.mjs → finalize.sh
set -e; O=${1:-/Users/egurvanov/python/sims/assets/models/characters/modern}; mkdir -p $O
b() { node dress.mjs rig/raw_$1.glb rig/d_$2.glb "$3" | tail -1; bash finalize.sh rig/d_$2.glb $O/$2.glb "*{Hair,Eye,Normal,Rough,ORM}*" 1024 512 1; }
b m_parted man      '{"name":"Man","top":"tee","bottom":"jeans","smooth":10,"colors":{"shirt":"#3f6fb0","pants":"#2c3a57","shoes":"#3a3a3a","hair":"#5a3a22"}}'
b m_beard  man_b    '{"name":"ManB","top":"sweater","bottom":"jeans","smooth":10,"colors":{"shirt":"#7a2e2e","pants":"#8a7556","shoes":"#5a3a22","hair":"#1c1410"}}'
b f_long   woman    '{"name":"Woman","top":"tee","bottom":"jeans","smooth":10,"colors":{"shirt":"#d9a441","pants":"#34496e","shoes":"#f0f0f0","hair":"#8a5a2b"}}'
b f_buns   woman_b  '{"name":"WomanB","top":"tee","dress":true,"smooth":10,"colors":{"dress":"#b0413e","shoes":"#6b3b2a","hair":"#2a1a10"}}'
b m_elder  elder    '{"name":"Elder","top":"sweater","bottom":"jeans","smooth":10,"colors":{"shirt":"#6b7a5a","pants":"#4a4a4a","shoes":"#3a2a20","hair":"#c9c9c4"}}'
b f_buns   elder_f  '{"name":"ElderF","top":"sweater","dress":true,"dressLen":-0.16,"smooth":10,"colors":{"dress":"#6a5a8a","shoes":"#3a2a20","hair":"#d2d2cc"}}'
b m_buzz   child_m  '{"name":"ChildM","top":"tee","bottom":"shorts","smooth":10,"colors":{"shirt":"#d4553a","pants":"#3a5a8a","shoes":"#eeeeee","hair":"#6a4a2a"},"child":{"scale":0.65,"head":1.3}}'
b f_long   child_f  '{"name":"ChildF","top":"tee","dress":true,"smooth":10,"colors":{"dress":"#e07aa0","shoes":"#f0f0f0","hair":"#b07a3a"},"child":{"scale":0.65,"head":1.3}}'
