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

`scripts/fetch_sox_data.py`는 `SOX_NASDAQ_TRADE_DATE`가 없으면 최근 영업일 후보를 최신순으로 시도해 Nasdaq SOX 구성종목을 가져오고, 성공한 refresh마다 `dataAsOf` 기준 snapshot을 `data/sox-history.json`에 append/replace 합니다. 부분 provider 실패는 `status.level=degraded`와 failures 목록으로 명시합니다. 운영 자동화는 모든 실행에서 `--fail-on-degraded --require-current`를 적용하므로 최신 예상 거래일 미달이나 부분 실패 후보를 공개하지 않습니다. 따라서 브라우저는 최신값뿐 아니라 저장된 원하는 기준일도 선택해서 볼 수 있습니다.

## 수집 품질과 실적 계산

수집과 예약 생략 판정은 종목별 provider 오류, 가격 기준일 일치, 구성종목 수와 핵심 재무정보를 함께 확인합니다. 전체 `status.level=ok`만으로 부분 실패를 숨기거나 혼합 기준일을 최신으로 인정하지 않습니다. 엄격 모드는 실패 시 기존 JSON을 교체하지 않으며, 저장 이력의 손상·읽기 실패도 새 이력으로 덮어쓰지 않습니다.

EPS·순이익의 전년 값이 0 이하이면 일반 YoY는 `null`이고 화면에는 흑자전환·적자축소 등 상태를 표시합니다. 순위 입력은 별도의 `(현재−전년)/|전년|` 변화 신호이며 전년 값이 0인 항목은 점수에서 제외합니다. 양수 기저의 기존 YoY와 가격 계산은 유지합니다. 새 산출물은 `absolute_prior_base_change_v1` 방법론과 비교한 분기 값·날짜를 기록하며, 과거 날짜의 저장 결과는 재계산하지 않습니다.

Yahoo `trailingMarketCap`이 API 오류 없이 metadata만 반환하면 동일 Yahoo 공개 종목 페이지의 구조화된 quote 값을 확인합니다. 종목명·티커·거래소·USD 통화, 완료된 목표 거래일, chart의 정규장 시각·수정 전 가격, 시가총액과 발행주식 수 × 가격의 일치를 모두 검증한 경우에만 원시 시가총액을 사용하고 `dataQuality.marketCapRepair`에 URL·조회 시각·기준일·검증 입력을 기록합니다. 과거 시가총액·분기 주식 수나 시간외 가격을 대입하지 않으며 검증 실패는 계속 공개를 차단합니다.

MU의 TTM 매출·순이익 시계열이 모두 metadata만 반환하면 Yahoo 공개 `quoteSummary`의 TTM 원시값을 Micron 공식 최신 실적 목록·연간 GAAP 표와 대조합니다. 최신 공시가 회계연도 말이고 Yahoo의 최근 분기·회계연도 말이 일치하며, 52/53주 전체 기간과 USD 단위·표 간 수치·순이익률이 검증될 때만 사용합니다. 독립된 GAAP 열과 Non-GAAP 열의 표기·순서가 정확해야 합니다. 오래된 분기들을 합산하지 않습니다. 더 새로운 중간분기 공시, 중복·모호한 자료, 정정에 따른 수치 불일치, 140일을 넘긴 보고기간은 보완을 거부합니다. `dataQuality.ttmRepair`에 실제 기간·출처 URL·최신 10-K 링크·조회 시각·문서 해시를 남기며 기존 분기 지표와 과거 결과는 변경하지 않습니다. 자동 검증은 Yahoo quote, Micron 실적 목록과 실적 발표 본문을 읽습니다. 10-K는 최신 목록의 링크만 확인하며 본문을 읽거나 검증하지 않습니다. 이 범위는 `issuerFilingCheck`에도 명시합니다.

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

> 주의: `proxy weight`는 Yahoo 시가총액(시계열 또는 검증된 현재 정규장 quote)을 SOX universe 안에서 정규화한 값이며, 공식 SOX 지수 비중이 아닙니다. 본 페이지는 개인 리서치용이며 투자, 세무, 법률 또는 매매 조언이 아닙니다.

## 로컬 실행

```bash
python3 scripts/refresh_sox_pipeline.py
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
python3 scripts/fetch_sox_data.py --fail-on-degraded --require-current --output-dir /tmp/sox-candidate --history-source-dir data
SOX_DATA_DIR=/tmp/sox-candidate npm run verify
```

## 검증

```bash
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

정기 수집·계산은 Quant2Alpha 소유 Windows 배치로 이관했다. 이 저장소의 기존 cron·push 수집, 교차 프로젝트 대기, 수집 결과 commit/push 작업은 제거했다. 과거 판본의 사이트·원자료·분석 결과와 출처 메타데이터는 그대로 보존한다. 저장 JSON의 cadence와 workflow URL은 당시 운영의 기록이며 현재 수집 예약이 아니다. 정식 결과는 `https://quant2alpha.com/sox/`에서 확인한다.

`.github/workflows/deploy-pages.yml`는 명시적 수동 요청으로 보존된 UI와 데이터를 다시 게시하는 경로만 남긴다. 기본 브랜치 검사, 기존 데이터 전체 SHA 보존, `npm test`, 업로드 전·공개 직전 현재 main SHA 대조, 공개 HTML·JS·CSS·JSON 7개 파일의 exact-byte readback을 유지한다. 수집하거나 데이터 시각·상태를 새로 쓰지 않는다.

```bash
gh workflow run deploy-pages.yml --ref main --repo SonChangGi/sox
```

추가 프런트엔드 CI `.github/workflows/verify-frontend.yml`는 유지한다. `scripts/refresh_sox_pipeline.py`·`--require-current`와 공급·달력·금융 검증은 이전 연구를 재현하는 소유 코드로 보존하며 새 정기 실행은 Quant2Alpha에서 관리한다. 수집기 기본 계산과 기존 가격·거래량은 이번 자동화 퇴역으로 바뀌지 않는다.
