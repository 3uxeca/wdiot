# Deep Interview Spec: WDIOT (왜켰더라 — "Why Did I Open This")

## Metadata
- Interview ID: wdiot-2026-05-20
- Rounds: 6
- Final Ambiguity Score: 17%
- Type: greenfield
- Generated: 2026-05-20
- Threshold: 0.2 (20%)
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.40 | 0.340 |
| Constraint Clarity | 0.90 | 0.30 | 0.270 |
| Success Criteria | 0.75 | 0.30 | 0.225 |
| **Total Clarity** | | | **0.835** |
| **Ambiguity** | | | **0.165** |

## Goal
WDIOT("왜켰더라" / "Why did I open this..?")는 **macOS 개인용 작업맥락 복원 에이전트**다.

평소에는 메뉴바 데몬으로 사용자의 작업 맥락 — 활성 앱, 브라우저 탭/URL/검색어, Cursor/VSCode 파일 활동 — 을 로컬 SQLite 타임라인에 패시브 수집한다. 사용자가 딴짓 후 흐름을 잃었을 때 **전역 단축키**를 누르면, 최근 N분의 컨텍스트를 클라우드 LLM API로 보내 다음 3가지를 복원·표시한다:

1. **한 줄 의도 요약 (한국어)** — "아까 줌 상호작용 이후 Chart.js annotation 위치 어긋남 버그를 고치려던 것 같아요." (활동 로그가 아니라 *추론*으로 읽혀야 함)
2. **최소 근거 (한국어)** — "왜냐면: QueueChart.tsx 편집 · \"chartjs annotation zoom\" 검색 · chartOptions.ts 확인" (신뢰 확보 + 기억을 깨우는 cognitive trigger)
3. **즉시 복귀 액션 (한국어 라벨)** — `[작업 이어가기]` `[관련 탭 열기]` `[타임라인 보기]` (텍스트가 아니라 실제로 *실행*되는 버튼)

v1의 핵심 가치는 **"AI가 진짜 내 의도를 추론했다"는 첫 소름 경험**이며, v1으로 검증하려는 것은 *intent reconstruction 자체가 사용자에게 가치 있는가* 이다.

## Constraints
- **플랫폼**: macOS 전용
- **사용자**: 단일 사용자(개발자 본인용 개인 도구) — 멀티유저·인증·스케일 고려 없음
- **호스트 앱**: Electron, 전 계층 TypeScript 100% (메뉴바 앱·팔레트·IDE 확장·SQLite·LLM 연동 모두 TS)
- **UI 언어**: 모든 사용자 대면 텍스트는 **한국어** — 메뉴바 메뉴, 팔레트 UI 라벨/버튼, 그리고 LLM이 생성하는 의도 요약·근거·복귀 액션 라벨까지 전부 한국어. LLM 프롬프트는 반드시 한국어로 출력하도록 지시한다. (코드 식별자·내부 로그·DB 스키마/컬럼명은 영어 유지)
- **앱 형태**: 메뉴바 데몬(상시 추적) + 전역 단축키 팔레트(예: Cmd+Shift+W)로 "뭐하려고 했지" 진입
- **추론 엔진**: 클라우드 LLM API (기본 Claude, GPT로 교체 가능한 pluggable 구조)
- **데이터 흐름**: 평소 로컬 SQLite에만 저장. 단축키를 누른 *그 순간에만* 최근 N분 컨텍스트 윈도우를 API로 전송. 상시/스트리밍 전송 금지.
- **저장소**: 로컬 SQLite (활동 타임라인)
- **데이터 캡처 (하이브리드)**:
  - 활성 앱 + 윈도우 제목 + 전환 시점: macOS NSWorkspace 계열 API
  - 브라우저(Chrome/Safari) 열린 탭·방문 URL·검색어: AppleScript (검색어는 URL에서 파싱)
  - IDE(Cursor 주력, VSCode 호환): 직접 만든 경량 Cursor/VSCode 호환 확장
- **IDE 확장 수집 범위**: 현재 workspace, 활성 파일 경로, 최근 연 파일, 커서/선택 영역, git diff 여부
- **컨텍스트 윈도우**: 최근 N분 (기본값 ~30분, 설정 가능)

## Non-Goals (v1에서 명시적으로 제외)
- Interrupt detection / 집중 깨짐 자동 감지 (ChatGPT Phase 3)
- 실시간 에이전트 인터벤션 ("25분째 같은 에러 보고 있는데...")
- Task clustering, 작업 흐름 회고, 감정 추론
- 로컬 LLM / 온디바이스 추론 (privacy 니즈가 검증된 이후 재고)
- **Cursor 내부 AI 채팅 내용 수집** (접근성 애매 + 개인정보/보안 이슈로 범위 폭증)
- Vector DB / embedding 기반 맥락 clustering (연기)
- 주기적 Memory Snapshot 저장 시스템 (ChatGPT Phase 2 개념 — v1은 on-demand 컨텍스트 윈도우로 대체)
- Slack / Discord / Gmail 등 커뮤니케이션 연동
- Chrome/Safari 외 브라우저, Cursor/VSCode 외 IDE
- Windows / Linux 지원

## Acceptance Criteria
- [ ] 메뉴바 앱이 상시 실행되며 WDIOT 아이콘을 표시한다
- [ ] 백그라운드 트래커가 활성 앱 전환을 타임스탬프와 함께 로컬 SQLite에 기록한다
- [ ] 브라우저 활동(열린 탭, 방문 URL, URL에서 파싱한 검색어)을 Chrome/Safari에 대해 AppleScript로 캡처한다
- [ ] Cursor/VSCode 호환 확장이 현재 workspace·활성 파일 경로·최근 연 파일·커서/선택·git diff 여부를 보고한다
- [ ] 전역 단축키가 "뭐하려고 했지" 팔레트를 띄운다
- [ ] 단축키 입력 시 최근 N분 컨텍스트가 조립되어 클라우드 LLM API로 전송된다
- [ ] 팔레트가 3단 결과를 표시한다: ① 한 줄 의도 요약 ② 최소 근거 bullet ③ 복귀 액션 버튼
- [ ] 모든 사용자 대면 텍스트(메뉴바·팔레트 라벨·버튼·LLM 생성 의도/근거/액션)가 한국어로 표시된다
- [ ] 복귀 액션이 *실행형*이다: `[Open Related Tabs]`는 실제로 탭을 재오픈하고, `[Show Timeline]`은 타임라인을 연다 (텍스트 안내 아님)
- [ ] 의도 요약이 활동 로그가 아닌 *추론*으로 읽힌다 ("You were probably... after...")
- [ ] Cursor 내부 AI 채팅 내용은 절대 수집되지 않는다
- [ ] 컨텍스트 데이터는 단축키를 누른 순간에만 외부로 나가며, 상시 전송하지 않는다

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "단순 메모/활동 로그 앱" | 성공 화면을 구체화하라고 압박 | 활동 나열은 명시적 실패 예시. 성공 = 의도 추론 + 근거 + 실행형 복귀 액션 3종 |
| "로컬 퍼스트가 좋음 (민감정보)" | Contrarian: 반대로 클라우드면? | v1 핵심은 추론 품질·빠른 iteration. 클라우드 LLM API 채택. 저장만 로컬, 전송은 버튼 누른 순간만 |
| "VSCode를 들여다본다" | 주력 IDE 확인 | 주력은 Cursor. Cursor가 VSCode fork라 확장 API 재사용 가능 → "Cursor/VSCode 호환 경량 확장" |
| "IDE 컨텍스트를 풍부하게 수집" | 어디까지가 v1인가 | 최소 컨텍스트만(workspace/활성 파일/최근 파일/커서/git diff). Cursor AI 채팅은 제외 |
| "Tauri가 멋있다 (개인 선호)" | Simplifier: 가장 단순한 스택? | v1 목표는 검증 속도. TS 단일 언어 통일 = Electron 채택. Tauri는 효율 단계에서 재고 |
| "MVP는 추적+타임라인부터" | v1 만족 기준 재질문 | 핵심 쾌감("뭐하려고 했지" 복원)이 v1에 반드시 포함되어야 함 |

## Technical Context (greenfield)
- **언어/런타임**: TypeScript 100%, Electron
- **저장소**: 로컬 SQLite (예: better-sqlite3)
- **LLM**: 클라우드 API, 기본 Claude (Anthropic SDK), GPT 교체 가능한 pluggable provider 인터페이스
- **데이터 캡처 계층**:
  - 활성 앱: macOS NSWorkspace 계열 (Electron 네이티브 모듈 또는 보조 스크립트)
  - 브라우저: AppleScript (`osascript`)로 Chrome/Safari 탭·URL 조회
  - IDE: 별도 Cursor/VSCode 호환 확장 (VSCode Extension API, TS) → 로컬 IPC/파일/HTTP로 데몬에 보고
- **3대 구성요소**: ① 메뉴바 데몬(추적+저장) ② 단축키 팔레트 UI(React/Tailwind 가능) ③ Cursor/VSCode 확장
- **권장 파라미터**: 컨텍스트 윈도우 기본 30분

## Ontology (Key Entities) — 최종 라운드 기준
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Activity | core domain | type(app_switch/tab/file_edit/search), timestamp, source, payload | Timeline has many Activity; ContextWindow groups Activity |
| Timeline | core domain | activities[], 영속(SQLite) | Timeline has many Activity |
| ContextWindow | core domain | rangeMinutes(~30), activities[], assembledAt | 단축키 시점에 Timeline에서 조립; Intent의 입력 |
| Intent | core domain | summary(한 줄), confidence | ContextWindow → LLM → Intent; Intent has Evidence, ResumeAction |
| Evidence | supporting | bullets[](edited/searched/checked) | Intent has many Evidence |
| ResumeAction | core domain | label, kind(open_tabs/resume_work/show_timeline), 실행 payload | Intent has many ResumeAction |
| Project | supporting | workspace 경로, 이름 | Activity belongs to Project |
| Task | supporting (deferred) | 활동 묶음 | Phase 3 — task clustering |
| Snapshot | supporting (deferred) | 주기적 상태 저장 | ChatGPT Phase 2 — v1은 ContextWindow로 대체 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | N/A |
| 2 | 5 | 0 | 0 | 5 | 100% |
| 3 | 7 | 2 (Evidence, ResumeAction) | 0 | 5 | 71% |
| 4 | 8 | 1 (ContextWindow) | 0 | 7 | 88% |
| 5 | 9 | 1 (Project) | 0 | 8 | 89% |
| 6 | 9 | 0 | 0 | 9 | 100% |

→ 도메인 모델이 Round 6에서 완전 수렴(2라운드 연속 동일, 변경 0).

## Interview Transcript
<details>
<summary>Full Q&A (6 rounds)</summary>

### Round 1 — Targeting: Goal Clarity
**Q:** v1의 범위는 어디까지?
**A:** "추적 + '뭐하려고 했지' 복원" (Phase 1 + Phase 2)
**Ambiguity:** 73%

### Round 2 — Targeting: Constraint Clarity
**Q:** WDIOT은 어떤 형태로 존재?
**A:** "메뉴바 + 단축키 팔레트" (메뉴바 데몬 추적 + 단축키 팔레트로 복원)
**Ambiguity:** 62%

### Round 3 — Targeting: Success Criteria
**Q:** 어떤 답이 나오면 '성공'?
**A:** 3단 구조 확정 — ① 한 줄 의도 요약 ② 최소 근거(cognitive trigger) ③ 실행형 복귀 액션. 단순 활동 로그는 명시적 실패. 성공 화면 목업 직접 제시.
**Ambiguity:** 38%

### Round 4 — Contrarian Mode — Targeting: Constraint Clarity
**Q:** (가정 뒤집기) 로컬 퍼스트 vs 클라우드 — 추론 엔진을 어디에?
**A:** 클라우드 LLM API. v1 핵심은 추론 품질·빠른 iteration. 저장은 로컬 SQLite, 전송은 버튼 누른 순간의 최근 N분만.
**Ambiguity:** 30%

### Round 5 — Targeting: Constraint Clarity
**Q:** 브라우저·IDE 데이터를 어떻게 캡처?
**A:** 하이브리드 — 브라우저는 AppleScript, IDE는 Cursor/VSCode 호환 경량 확장. 최소 컨텍스트만. Cursor AI 채팅은 v1 제외.
**Ambiguity:** 21%

### Round 6 — Simplifier Mode — Targeting: Constraint Clarity
**Q:** (가장 단순한 길) 호스트 프레임워크는?
**A:** Electron, TypeScript 100%. 검증 속도·디버깅 단순성 우선. Tauri/Rust는 효율 단계에서 재고.
**Ambiguity:** 17% ✅ (임계값 통과)

</details>
