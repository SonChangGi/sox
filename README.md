# SOX Semiconductor Research Cockpit

필라델피아 반도체 지수(SOX / PHLX Semiconductor Sector Index) 구성종목을 정적 GitHub Pages 방식으로 분석하는 리서치 대시보드입니다.

## 제공하는 것

- Nasdaq Global Index Watch의 SOX 구성종목을 기준으로 한 30개 종목 universe
- Yahoo Finance 공개 chart/fundamentals-timeseries 기반 가격·재무 데이터 refresh script
- 공식 무료 비중이 없을 때 시가총액 정규화 `proxy weight`를 명확히 표시
- 가격 모멘텀: 1M/3M/6M/12M 수익률, 50/200일 이동평균 갭, 52주 drawdown/range, 63일 변동성, RSI
- 실적 모멘텀: 분기 매출/EPS/순이익 YoY, TTM 순이익률, trailing P/E 컨텍스트
- 정적 웹 UI: KPI 카드, 비중/모멘텀 그래프, 가격-vs-실적 quadrant, 검색/정렬 테이블, 방법론/한계
- quant-dashboard hub 연동용 `data/summary.json` (`quant-research-summary` contract)
- 저장된 날짜를 고를 수 있는 `data/sox-history.json` snapshot history

## 데이터 경계

브라우저는 외부 금융 API를 직접 호출하지 않습니다. `assets/app.js`는 커밋된/generated JSON만 읽습니다.

- 대시보드 데이터: `data/sox-analysis.json`
- 날짜 선택 history: `data/sox-history.json`
- 허브 요약: `data/summary.json`
- refresh script: `scripts/fetch_sox_data.py`

`scripts/fetch_sox_data.py`는 `SOX_NASDAQ_TRADE_DATE`가 없으면 최근 영업일 후보를 최신순으로 시도해 Nasdaq SOX 구성종목을 가져오고, 성공한 refresh마다 `dataAsOf` 기준 snapshot을 `data/sox-history.json`에 append/replace 합니다. 따라서 브라우저는 최신값뿐 아니라 저장된 원하는 기준일도 선택해서 볼 수 있습니다.

> 주의: `proxy weight`는 Yahoo trailing market cap을 SOX universe 안에서 정규화한 값이며, 공식 SOX 지수 비중이 아닙니다. 본 페이지는 개인 리서치용이며 투자, 세무, 법률 또는 매매 조언이 아닙니다.

## 로컬 실행

```bash
npm run refresh
python3 -m http.server 8080
# http://localhost:8080 열기
```

## 검증

```bash
npm run refresh
npm test
```

검증은 다음을 확인합니다.

- `assets/app.js` 문법
- `data/sox-analysis.json`, `data/sox-history.json`, `data/summary.json` schema/coverage/proxy-weight contract
- 자동화 cadence/Actions workflow URL/검증 metadata
- research-only/proxy-weight/source caveat copy
- 정적 서버 smoke (`index.html`, JS, CSS, JSON assets)

## 배포 메모

`.github/workflows/deploy-pages.yml`는 07:30 KST Tue-Sat에 1차 실행되고 09:30/11:30/13:30 KST Tue-Sat에 2시간 간격 retry를 수행합니다. 예약 run은 `scripts/check_sox_freshness.py`가 이미 06:30 KST 이후 최신 예상 미국 정규장 기준일을 저장한 것으로 확인하면 skip하고, 실패/지연 시 다음 slot에서 다시 수집합니다.

GitHub Pages 배포 후 `https://sonchanggi.github.io/sox/`와 `https://sonchanggi.github.io/sox/data/summary.json`을 public readback으로 확인하세요.
