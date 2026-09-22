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

`.github/workflows/deploy-pages.yml`는 화~토 06:43 KST에 1차 수집하고 10:13/13:43 KST에 재시도합니다. Momentum(07:17/10:47/14:17), Best Factor(08:43/12:13/15:43), ETF(한국 공시 거래일 09:47/13:17/16:47)와 분산합니다. GitHub 예약이 늦어 겹치면 `automation_admission.py`가 다른 프로젝트의 먼저 시작된 수집·배포가 완료될 때까지 최대 45분 대기합니다. API 조회 실패·시간 초과는 수집을 시작하지 않고 실패로 남기며 다음 예약에서 재시도합니다. 최신 예상 거래일은 06:30 KST 수집 창과 미국 주식시장 휴장일을 반영합니다. 금요일 정상 결과는 주말과 월요일에도 최신으로 인정하며, 미래 거래일·미래 생성 시점은 거부합니다.

운영 경로는 다음 순서로 실행됩니다.

1. 최신 거래일·종목별 품질·`status.level=ok`인 경우에만 수집을 생략합니다. 공개 파일 7개까지 현재 커밋과 일치해야 배포도 생략합니다. 저장 데이터만 최신이고 공개 결과가 오래됐거나 누락되면 재수집 없이 검증·배포를 복구합니다.
2. 시작 시 고정한 목표 거래일을 모든 시도에 전달합니다. 장기 Yahoo 시세의 최신 종가가 비어 있으면 동일 출처의 1일 일봉에서 정확한 완료 거래일·정규장 종료·실제 수정종가·거래량을 확인해 빠진 최신일만 보완합니다. 이전 가격은 변경하거나 보간하지 않고 출처·수집 시각을 기록합니다. `scripts/refresh_sox_pipeline.py`가 임시 디렉터리에 수집하고 최신성·품질 및 `npm test` 전체 검증을 통과한 JSON 묶음만 교체합니다. 수집은 최대 3회, 30초 간격으로 시도하며 실패한 검증 후보는 기존 데이터를 덮어쓰지 않습니다. 개별 HTTP 요청은 429·5xx·timeout 등 일시적 오류에만 최대 3회 재시도합니다.
3. source SHA와 원격 main이 수집 도중 달라지면 커밋·push를 거부합니다. 기본 브랜치만 운영 가능하며 push·수동 요청도 동일하게 최신성을 검사하고 필요할 때만 수집합니다. 같은 날 이미 정상 완료한 수동·재시도 요청은 중복 수집하지 않습니다.
4. 검증된 `index.html`, `assets/`, `data/`만 Pages artifact에 포함합니다. 배포 직전에도 main SHA와 데이터 최신성을 확인합니다.
5. `scripts/verify_publication.py`가 공개 HTML·JS·CSS와 JSON 등 7개 파일의 SHA-256 및 실제 거래일·품질을 확인합니다. 재수집·검증·배포·공개 확인 중 필요한 단계가 실패하면 전체 자동화도 실패합니다. 기존 페이지가 열린다는 이유로 성공 처리하지 않습니다.

수동 재수집·배포도 동일한 경로입니다.

```bash
gh workflow run deploy-pages.yml --ref main --repo SonChangGi/sox
python3 scripts/verify_publication.py --attempts 6 --retry-delay 5
```

추가 프런트엔드 검증은 `.github/workflows/verify-frontend.yml`에서 별도로 실행합니다. 공개 화면은 기존 루트 정적 앱을 유지합니다. 수집·검증·배포·공개 확인 결과는 Actions 실행 요약에서 각각 확인할 수 있습니다.
