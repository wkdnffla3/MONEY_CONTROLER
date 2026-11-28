// 개인정보 처리방침에 들어가는 운영자 정보 (배포 환경 변수로 설정, 비어 있으면 안내 문구)
//  VITE_PRIVACY_CONTACT : 문의 연락처 (이메일 등)  ← 꼭 설정하세요
//  VITE_OPERATOR_NAME   : 운영자 이름 또는 별명 (개인정보 보호책임자)
//  VITE_DATA_REGION     : Supabase 프로젝트 지역 (대시보드 Project Settings → General → Region, 예: "싱가포르(ap-southeast-1)")
const env = import.meta.env || {};
const v = (k) => String(env[k] || '').trim();

export const PRIVACY_EFFECTIVE = '2026-11-28'; // 처리방침을 바꾸면 날짜를 고치고 README 변경 내역에 적기
export const PRIVACY_CONTACT = v('VITE_PRIVACY_CONTACT');
export const OPERATOR_NAME = v('VITE_OPERATOR_NAME');
export const DATA_REGION = v('VITE_DATA_REGION');
export const PRIVACY_HASH = '#privacy';
