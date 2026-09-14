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

`scripts/fetch_sox_data.py`는 `SOX_NASDAQ_TRADE_DATE`가 없으면 최근 영업일 후보를 최신순으로 시도해 Nasdaq SOX 구성종목을 가져오고, 성공한 refresh마다 `dataAsOf` 기준 snapshot을 `data/sox-history.json`에 append/replace 합니다. 부분 provider 실패는 `status.level=degraded`와 failures 목록으로 명시합니다. 이 상태는 다음 예약 슬롯에서도 다시 수집되며, 마지막 13:30 KST 재시도와 수동 점검은 `--fail-on-degraded`로 실패를 드러내 last-good 공개 결과를 보호합니다. 따라서 브라우저는 최신값뿐 아니라 저장된 원하는 기준일도 선택해서 볼 수 있습니다.

## 수집 품질과 실적 계산

수집과 예약 생략 판정은 종목별 provider 오류, 가격 기준일 일치, 구성종목 수와 핵심 재무정보를 함께 확인합니다. 전체 `status.level=ok`만으로 부분 실패를 숨기거나 혼합 기준일을 최신으로 인정하지 않습니다. 엄격 모드는 실패 시 기존 JSON을 교체하지 않으며, 저장 이력의 손상·읽기 실패도 새 이력으로 덮어쓰지 않습니다.

EPS·순이익의 전년 값이 0 이하이면 일반 YoY는 `null`이고 화면에는 흑자전환·적자축소 등 상태를 표시합니다. 순위 입력은 별도의 `(현재−전년)/|전년|` 변화 신호이며 전년 값이 0인 항목은 점수에서 제외합니다. 양수 기저의 기존 YoY와 가격 계산은 유지합니다. 새 산출물은 `absolute_prior_base_change_v1` 방법론과 비교한 분기 값·날짜를 기록하며, 과거 날짜의 저장 결과는 재계산하지 않습니다.

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

기존 파일을 보존한 수집 후보 검증:

```bash
python3 scripts/fetch_sox_data.py --fail-on-degraded --output-dir /tmp/sox-candidate --history-source-dir data
SOX_DATA_DIR=/tmp/sox-candidate npm run verify
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

`.github/workflows/deploy-pages.yml`는 07:30 KST Tue-Sat에 1차 실행되고 09:30/11:30/13:30 KST Tue-Sat에 2시간 간격 retry를 수행합니다. 예약 run은 먼저 lightweight freshness preflight만 실행합니다. `scripts/check_sox_freshness.py`가 미국 주식시장 full-day 휴장일을 반영한 최신 예상 정규장 기준일이 06:30 KST 이후 저장됐고 `status.level=ok`인 경우에만 수집, 검증, Pages artifact upload, 배포를 모두 skip합니다. stale/missing/degraded 상태이거나 수동 실행이면 다시 수집하고, 마지막 예약 재시도와 수동 실행은 `--fail-on-degraded`로 건강하지 않은 후보를 계속 차단합니다. 자동 예약·push에서 이 차단이나 배포 오류가 발생해도 별도 health job이 기존 공개 `index.html`, `summary.json`, `sox-analysis.json`을 읽을 수 있으면 실패 메일을 만들지 않습니다. 해당 공개 파일이 반복 확인 후에도 사용할 수 없을 때만 자동 실패 신호를 냅니다. 수동 실행은 계속 엄격합니다. production workflow는 기본 브랜치에서만 실행됩니다. 수집을 시작한 뒤 원격 branch가 바뀌면 데이터 변경 유무와 관계없이 후보를 거부하고, 업로드한 artifact의 source SHA가 배포 직전 main과 다르면 배포도 거부합니다.

GitHub Pages 배포 후 workflow는 `sox-analysis.json`, `sox-history.json`, `summary.json`의 SHA-256을 실제 공개 URL에서 다시 읽어 업로드한 artifact와 byte-identical한지 확인합니다.

추가 프론트 검증은 `.github/workflows/verify-frontend.yml`에서 별도로 실행합니다. 운영 배포 경로는 저장소 루트로 유지합니다. 자동 실행의 성공 표시·실패 알림은 기존 페이지 가용성 정책을 따르며, 수집·검증·배포·공개 해시 비교의 실제 결과는 Actions 실행 요약 표에서 각각 확인합니다.
