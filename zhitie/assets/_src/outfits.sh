#!/bin/bash
# Наряды для CAS: лысое тело + одежда (dress.mjs) → assets/models/characters/outfits/<g>_<style>.glb
set -e; O=${1:-/Users/egurvanov/python/sims/assets/models/characters/outfits}; mkdir -p $O
b() { node dress.mjs rig/raw_bald_$1.glb rig/o_$2.glb "$3" | tail -1; bash finalize.sh rig/o_$2.glb $O/$2.glb "*{Hair,Eye,Normal,Rough,ORM}*" 1024 512 1; }
S='"smooth":10'
b m m_casual     "{\"name\":\"m_casual\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#3f6fb0\",\"pants\":\"#2c3a57\",\"shoes\":\"#3a3a3a\"}}"
b m m_formal     "{\"name\":\"m_formal\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#eef0f2\",\"pants\":\"#22252b\",\"shoes\":\"#151515\"}}"
b m m_sport      "{\"name\":\"m_sport\",\"top\":\"tank\",\"bottom\":\"shorts\",$S,\"colors\":{\"shirt\":\"#c0392b\",\"pants\":\"#1d1d1d\",\"shoes\":\"#f2f2f2\"}}"
b m m_sleep      "{\"name\":\"m_sleep\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#9fb7d9\",\"pants\":\"#9fb7d9\",\"shoes\":\"#7a5a3a\"}}"
b m m_swim       "{\"name\":\"m_swim\",\"top\":\"none\",\"bottom\":\"shorts\",\"shoes\":false,$S,\"colors\":{\"pants\":\"#2f7fbf\"}}"
b m m_work_repair "{\"name\":\"m_work_repair\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#3f5f8a\",\"pants\":\"#3f5f8a\",\"shoes\":\"#3a2a20\"}}"
b m m_work_police "{\"name\":\"m_work_police\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#1d2a45\",\"pants\":\"#1d2a45\",\"shoes\":\"#111111\"}}"
b m m_work_medic "{\"name\":\"m_work_medic\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#5fb3a8\",\"pants\":\"#5fb3a8\",\"shoes\":\"#f2f2f2\"}}"
b m m_work_fire  "{\"name\":\"m_work_fire\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#b8862a\",\"pants\":\"#b8862a\",\"shoes\":\"#111111\"}}"
b m m_work_chef  "{\"name\":\"m_work_chef\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#f4f4f2\",\"pants\":\"#3a3a3a\",\"shoes\":\"#111111\"}}"
b f f_casual     "{\"name\":\"f_casual\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#d9a441\",\"pants\":\"#34496e\",\"shoes\":\"#f0f0f0\"}}"
b f f_dress      "{\"name\":\"f_dress\",\"top\":\"tee\",\"dress\":true,$S,\"colors\":{\"dress\":\"#b0413e\",\"shoes\":\"#6b3b2a\"}}"
b f f_formal     "{\"name\":\"f_formal\",\"top\":\"sweater\",\"dress\":true,\"dressLen\":-0.2,$S,\"colors\":{\"dress\":\"#1d1d2a\",\"shoes\":\"#111111\"}}"
b f f_sport      "{\"name\":\"f_sport\",\"top\":\"tank\",\"bottom\":\"shorts\",$S,\"colors\":{\"shirt\":\"#e0457a\",\"pants\":\"#1d1d1d\",\"shoes\":\"#f2f2f2\"}}"
b f f_sleep      "{\"name\":\"f_sleep\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#f2b8c8\",\"pants\":\"#f2b8c8\",\"shoes\":\"#f2f2f2\"}}"
b f f_swim       "{\"name\":\"f_swim\",\"top\":\"tank\",\"bottom\":\"briefs\",\"shoes\":false,$S,\"colors\":{\"shirt\":\"#e0457a\",\"pants\":\"#e0457a\"}}"
b f f_work_maid  "{\"name\":\"f_work_maid\",\"top\":\"tee\",\"dress\":true,$S,\"colors\":{\"dress\":\"#2b2b2b\",\"shoes\":\"#111111\"}}"
b f f_work_medic "{\"name\":\"f_work_medic\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#5fb3a8\",\"pants\":\"#5fb3a8\",\"shoes\":\"#f2f2f2\"}}"
b f f_work_police "{\"name\":\"f_work_police\",\"top\":\"tee\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#1d2a45\",\"pants\":\"#1d2a45\",\"shoes\":\"#111111\"}}"
b f f_work_repair "{\"name\":\"f_work_repair\",\"top\":\"sweater\",\"bottom\":\"jeans\",$S,\"colors\":{\"shirt\":\"#3f5f8a\",\"pants\":\"#3f5f8a\",\"shoes\":\"#3a2a20\"}}"
