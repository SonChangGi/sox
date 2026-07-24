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
- strict TypeScript/Vite 기반 독립 프런트엔드와 `sox-static-result/v1` 정적 결과 adapter
- canonical 11-project navigation과 공통 semantic token alias

## 데이터 경계

브라우저는 외부 금융 API를 직접 호출하지 않습니다. `assets/app.js`는 커밋된/generated JSON만 읽습니다.

- 대시보드 데이터: `data/sox-analysis.json`
- 날짜 선택 history: `data/sox-history.json`
- 허브 요약: `data/summary.json`
- refresh script: `scripts/fetch_sox_data.py`

`scripts/fetch_sox_data.py`는 `SOX_NASDAQ_TRADE_DATE`가 없으면 최근 영업일 후보를 최신순으로 시도해 Nasdaq SOX 구성종목을 가져오고, 성공한 refresh마다 `dataAsOf` 기준 snapshot을 `data/sox-history.json`에 append/replace 합니다. 부분 provider 실패는 기본적으로 `status.level=degraded`와 failures 목록으로 저장하고 workflow 실패로 보지 않습니다. 엄격히 실패 처리해야 하는 수동 점검에는 `--fail-on-degraded`를 사용할 수 있습니다. 따라서 브라우저는 최신값뿐 아니라 저장된 원하는 기준일도 선택해서 볼 수 있습니다.

## 공통 프런트엔드 경계

`frontend/`는 분석 코드를 복제하지 않는 독립 build입니다. 저장 기준일은
기존 결과 선택기이고, 티커·검색·정렬·테마는 화면 표시 설정입니다. 공개
화면에는 Python 재실행을 요청하는 분석 input이 없습니다. 수집과 Pages
공개는 인증된 owner operation으로 별도 분류합니다.

공통 패키지가 아직 publish되지 않았으므로 작은 호환 계층을 버전과
fingerprint로 고정합니다. 다른 worktree의 `file:` dependency나 다른
Pages origin의 runtime import는 사용하지 않습니다. 자세한 계약은
[`docs/shared-frontend-integration.md`](docs/shared-frontend-integration.md)를
참고하세요.

> 주의: `proxy weight`는 Yahoo trailing market cap을 SOX universe 안에서 정규화한 값이며, 공식 SOX 지수 비중이 아닙니다. 본 페이지는 개인 리서치용이며 투자, 세무, 법률 또는 매매 조언이 아닙니다.

## 로컬 실행

```bash
npm run refresh
python3 -m http.server 8080
# http://localhost:8080 열기
```

TypeScript 프런트엔드 preview:

```bash
npm ci --prefix frontend
npm run dev --prefix frontend
```

## 검증

```bash
npm run refresh
npm test
npm run verify --prefix frontend
```

검증은 다음을 확인합니다.

- `assets/app.js` 문법
- `data/sox-analysis.json`, `data/sox-history.json`, `data/summary.json` schema/coverage/proxy-weight contract
- 자동화 cadence/Actions workflow URL/검증 metadata
- research-only/proxy-weight/source caveat copy
- 정적 서버 smoke (`index.html`, JS, CSS, JSON assets)
- 공통 호환 파일 fingerprint, strict TypeScript, lint, unit/DOM test, Vite build
- `frontend/dist/data/*.json`과 저장소 public JSON의 byte identity
- 모든 공개 control이 `display`/`result_selector`이고 run POST가 없다는 계약

## 배포 메모

`.github/workflows/deploy-pages.yml`는 07:30 KST Tue-Sat에 1차 실행되고 09:30/11:30/13:30 KST Tue-Sat에 2시간 간격 retry를 수행합니다. 예약 run은 먼저 lightweight freshness preflight만 실행합니다. `scripts/check_sox_freshness.py`가 미국 주식시장 full-day 휴장일을 반영한 최신 예상 정규장 기준일이 이미 06:30 KST 이후 저장됐다고 판단하면 수집, 검증, Pages artifact upload, 배포를 모두 skip합니다. stale/missing 상태이거나 수동 실행이면 다시 수집하고, generated data 커밋은 push 전에 원격 branch 위로 rebase합니다.

GitHub Pages 배포 후 `https://sonchanggi.github.io/sox/`와 `https://sonchanggi.github.io/sox/data/summary.json`을 public readback으로 확인하세요.
