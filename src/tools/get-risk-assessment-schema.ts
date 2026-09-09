import { z } from "zod";
import type { ToolDefinition, McpToolResult } from "../lib/types.js";
import {
  renderSchemaAsMarkdown,
  type DocumentSchema,
} from "../lib/document-schemas.js";
import {
  getKrasMethodMeta,
  type KrasMethodCode,
} from "../lib/kras-methods-loader.js";

// 파일 최상단 상수 — 위험성평가 스키마
// 근거: 산안법 §36(법률 제21374호, 시행 2026-08-01) + 시행규칙 §37·§37의2·§37의3·§37의4
//       (고용노동부령 제477호, 시행 2026-08-01) + 위험성평가 고시 제2024-76호(세부사항)
// 2026-08-01 개정으로 방법·절차·시기·근로자 참여·공유·기록의 위임처가 고시에서 시행규칙으로 이동
// 상시평가 체계 반영: 체크리스트·3단계 판단·OPS 간편법 허용
// kras_method 파라미터로 KRAS 7개 공식 방법 선택 가능

const inputSchema = z.object({
  method: z
    .enum(["3x3_matrix", "3-step", "checklist", "ops", "auto"])
    .default("auto")
    .describe(
      "(레거시 명칭) 위험성평가 방법 (고시 §5) — auto/3x3_matrix/checklist/3-step/ops. KRAS 공식 명칭은 kras_method 파라미터 권장",
    ),
  kras_method: z
    .enum([
      "3step",
      "checklist",
      "key_factor",
      "frequency_severity",
      "occupational_health",
      "chemical",
      "construction_continuous",
    ])
    .optional()
    .describe(
      "KRAS 7개 공식 방법 코드 — 지정 시 해당 방법 가이드를 스키마에 첨부. list_kras_methods 또는 choose_assessment_method 결과의 code 사용",
    ),
  type: z
    .enum(["initial", "regular", "ad_hoc", "ongoing", "auto"])
    .default("auto")
    .describe(
      "평가 유형 (시행규칙 §37 ②) — initial(최초: 최초로 작업을 시작하기 전까지)/regular(정기: 최초평가 실시 연도의 다음 연도부터 매년 1회 이상)/ad_hoc(수시: 추가 유해·위험 요인 발생 우려 또는 중대산업사고·산업재해 발생 시 관련 작업 시작 전까지)/ongoing(상시: 고시 §15 ④ 매월·매주·매 작업일 모두 이행 시 수시·정기 갈음)",
    ),
});

type Input = z.infer<typeof inputSchema>;

function buildSchema(input: Input): DocumentSchema {
  const isOngoing = input.type === "ongoing";
  return {
    docType: "risk_assessment",
    docTypeKo: `위험성평가서${isOngoing ? " (상시평가)" : ""}`,
    purpose:
      "사업주가 사업장 유해·위험요인을 파악·평가하고 위험성 감소대책을 수립·실행하기 위한 법정 문서 (산안법 §36)",
    legalObligation:
      "산업안전보건법 §36 위반 시 과태료 — 미실시 1천만원 이하(§175 ④ 2호의2) / 근로자 참여·근로자대표 참여·결과 공유 위반 500만원 이하(§175 ⑤ 1호) / 결과 기록·보존 위반 300만원 이하(§175 ⑥ 2호의2). 산업재해 발생 시 가중 처벌",
    frequency: isOngoing
      ? "매월 1회 이상 발굴 + 매주 합동 논의·점검 + 매 작업일 작업 전 안전점검회의 (고시 §15 제4항 1·2·3호)"
      : "최초(최초로 작업을 시작하기 전까지, 규칙 §37 ② 1호) / 정기(최초평가 실시 연도의 다음 연도부터 매년 1회 이상, 규칙 §37 ② 2호) / 수시(추가 유해·위험 요인 발생 우려 또는 중대산업사고·산업재해 발생 시 관련 작업 시작 전까지, 규칙 §37 ② 3호)",
    primaryAuthor:
      "사업주 (총괄) + 관리감독자 + 안전관리자·보건관리자 + 근로자 (참여 필수 — 사업장 순회 점검이 원칙, 규칙 §37의2) + 근로자대표 (요구 시 참여, 법 §36 ③)",
    retention: "3년 (시행규칙 §37의4 ②)",
    sections: [
      {
        heading: "1. 기본 정보",
        fields: [
          { name: "사업장명", requirement: "mandatory", description: "사업자등록증 기재 명칭" },
          { name: "공사/사업 개요", requirement: "mandatory", description: "공사명·공종·규모·기간" },
          { name: "평가 실시일", requirement: "mandatory", description: "YYYY-MM-DD" },
          { name: "평가 유형", requirement: "mandatory", description: "최초/정기/수시 중 택일 (상시평가 운영 시 상시)", lawBasis: "시행규칙 §37 ② (실시 시기) · 고시 §15 ④ (상시평가)" },
          { name: "평가 방법", requirement: "mandatory", description: "3단계 판단/체크리스트/빈도·강도/핵심요인기술/건설상시/화학물질/산업보건", lawBasis: "고시 §7 (위험성평가의 방법)" },
          { name: "참여자 명단", requirement: "mandatory", description: "역할·성명·서명 — 근로자 참여 필수(사업장 순회 점검 원칙, 설문조사·면담 병행 가능). 근로자대표가 요구하면 근로자대표도 참여", lawBasis: "시행규칙 §37의2 (근로자 참여) · 법 §36 ③ (근로자대표 참여) · 고시 §6 (참여 국면 5종)" },
          { name: "근로자 참여 방법", requirement: "mandatory", description: "사업장 순회 점검(원칙) / 순회 점검이 불가능한 특별한 사정이 있으면 설문조사·면담·그 밖의 의견 수렴 방법 중 하나 이상", lawBasis: "시행규칙 §37의2 ①·②" },
        ],
      },
      {
        heading: "2. 유해·위험요인 파악",
        description: "산안법 §36 ① 의 유해·위험요인 6범주 중 해당 항목 기재",
        fields: [
          { name: "유해·위험요인 목록", requirement: "mandatory", description: "건설물·기계·원재료·가스·분진·작업행동 등", lawBasis: "산안법 §36 ①" },
          { name: "파악 방법", requirement: "recommended", description: "현장조사/근로자 면담/재해사례 분석" },
          { name: "관련 재해사례", requirement: "recommended", description: "유사 재해 1~3건 인용", example: "search_accident_cases 결과" },
        ],
      },
      {
        heading: "3. 위험성 추정·결정",
        description:
          input.method === "3x3_matrix"
            ? "빈도(1~3) × 강도(1~3) 매트릭스"
            : input.method === "3-step"
              ? "위험성 수준 3단계 판단법 (고시 §7)"
              : input.method === "checklist"
                ? "체크리스트법 (고시 §7)"
                : "방법 선택 가능 (시행규칙 §37 ③ 위임 → 고시 §7 KRAS 7방법 중 사업장 여건에 맞춰 선택)",
        fields: [
          { name: "위험성 크기", requirement: "mandatory", description: "선택한 방법에 따라 수치 또는 등급" },
          { name: "허용 가능 여부", requirement: "mandatory", description: "허용 가능/불가능 판정" },
          { name: "판정 근거", requirement: "recommended", description: "관련 법규·가이드 인용" },
        ],
      },
      {
        heading: "4. 위험성 감소대책",
        fields: [
          { name: "제거/대체/공학적/관리적/보호구 대책", requirement: "mandatory", description: "ERIC-PP 원칙 순서로 작성" },
          { name: "이행 책임자", requirement: "mandatory", description: "대책별 담당 지정" },
          { name: "이행 기한", requirement: "mandatory", description: "YYYY-MM-DD 또는 즉시" },
          { name: "감소대책 이행 후 잔존 위험성", requirement: "recommended", description: "재평가 결과" },
        ],
      },
      {
        heading: "5. 근로자 공유·기록·보존",
        description:
          "2026-08-01 시행 개정으로 실시 **전** 일정 고지와 실시 **후** 4개 항목 공유가 법정 의무가 되었고, 기록 항목에 참여한 근로자·근로자대표가 추가되었습니다",
        fields: [
          { name: "실시 전 일정 고지", requirement: "mandatory", description: "위험성평가 실시 일정을 사전에 근로자에게 알린 사실(고지일·방법)", lawBasis: "시행규칙 §37의3 1호 (신설)" },
          { name: "실시 후 공유 내용", requirement: "mandatory", description: "① 파악한 유해·위험 요인 ② 위험성 수준 결정 결과 ③ 개선대책 수립 내용 ④ 개선대책 이행 결과 — 4개 항목 모두", lawBasis: "시행규칙 §37의3 2호 (신설)" },
          { name: "공유 방법", requirement: "mandatory", description: "안전보건교육·설명회·사업장 게시·서면 또는 전자적 방법 등. 중대재해로 이어질 수 있는 유해·위험 요인은 작업 전 안전점검회의 등으로 상시 주지 노력", lawBasis: "법 §36 ④" },
          { name: "평가 결과 기록", requirement: "mandatory", description: "① 실시 시기 및 담당자 ② 참여한 근로자 및 근로자대표 ③ 실시 후 공유 4개 항목", lawBasis: "시행규칙 §37의4 ① (신설)" },
          { name: "보존 기간", requirement: "mandatory", description: "3년", lawBasis: "시행규칙 §37의4 ②" },
          { name: "차기 평가 예정일", requirement: "recommended", description: "정기 평가 주기 (매년 1회 이상)" },
        ],
      },
    ],
    signatureBlock: ["작성자 (안전관리자)", "검토자 (관리감독자)", "승인자 (사업주·경영책임자)", "근로자대표"],
    relatedLaws: [
      "산안법 §36 (위험성평가 의무 — 법률 제21374호, 시행 2026-08-01)",
      "산안법 시행규칙 §37 (방법·절차 및 시기 — 3단계 절차 + 최초·정기·수시)",
      "산안법 시행규칙 §37의2 (근로자 참여 — 사업장 순회 점검 원칙)",
      "산안법 시행규칙 §37의3 (근로자 공유 — 실시 전 일정 + 실시 후 4개 항목)",
      "산안법 시행규칙 §37의4 (결과 기록·보존 3년)",
      "산안법 §175 (과태료 — 미실시 1천만원 / 참여·공유 위반 500만원 / 기록·보존 위반 300만원)",
      "위험성평가 고시 §7 (위험성평가 방법 — KRAS 7방법, 규칙 §37 ③ 위임)",
      "위험성평가 고시 §15 ④ (상시평가 운영)",
    ],
    relatedTools: [
      "compile_safety_references(workType, docType='risk_assessment')",
      "search_accident_cases(keyword=공종)",
      "search_sif_archive(workType)",
      "analyze_construction_work_risks(workType)",
      "verify_safety_basis(claims)",
      "// 문서 필드 누락 검증은 별도 프로젝트 agent-quality-oss-mcp 범위",
    ],
    notes: [
      isOngoing
        ? "상시평가는 **매월 1회 이상 발굴 + 매주 합동점검 + 매 작업일 작업 전 안전점검회의**로 구성 (고시 §15 ④ 1·2·3호). 셋 모두 이행 시 수시·정기 갈음."
        : "정기평가는 최초평가 실시 연도의 다음 연도부터 매년 1회 이상 (규칙 §37 ② 2호). 수시평가는 추가 유해·위험 요인 발생 우려 또는 중대산업사고·산업재해 발생 시 관련 작업 시작 전까지 (규칙 §37 ② 3호).",
      "**2026-08-01 시행 개정 주의** — 최초평가 시점이 '사업 성립일부터 1개월 이내'가 아니라 **최초로 작업을 시작하기 전까지**입니다 (규칙 §37 ② 1호). 종전 고시 §15 ① 표현과 다르며 상위 규정이 우선합니다.",
      "**실시 전 일정 고지가 새로 의무화**되었습니다 (규칙 §37의3 1호). 평가를 마친 뒤 결과만 공유하면 위반입니다.",
      "근로자 참여는 **사업장 순회 점검이 원칙**이며, 순회 점검이 불가능한 특별한 사정이 있을 때만 설문조사·면담 등으로 대체할 수 있습니다 (규칙 §37의2). 참여자 서명 미기재 시 과태료 대상.",
      "위험성평가 결과 기록에 **참여한 근로자 및 근로자대표**를 반드시 적어야 합니다 (규칙 §37의4 ① 2호, 신설).",
      "감소대책은 제거(Eliminate) → 대체(Replace) → 공학적(Engineering) → 관리적(Administrative) → 보호구(PPE) 순서로 고려.",
      "KOSHA 위험성평가 인정사업장(KRAS)에 등록 시 산재보험료 감면 혜택.",
    ],
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input: Input = inputSchema.parse(rawInput ?? {});
  const schema = buildSchema(input);
  let md = renderSchemaAsMarkdown(schema);

  // KRAS 방법 지정 시 스키마 위에 방법 안내 헤더 추가
  let krasMeta: ReturnType<typeof getKrasMethodMeta> | undefined = undefined;
  if (input.kras_method) {
    krasMeta = getKrasMethodMeta(input.kras_method as KrasMethodCode);
    if (krasMeta) {
      const krasHeader = [
        `> ## 🎯 선택한 KRAS 방법: ${krasMeta.official} (\`${krasMeta.code}\`)`,
        `> - **접근**: ${krasMeta.approach === "quantitative" ? "정량 (매트릭스 산출)" : "정성 (직관·체크)"}`,
        `> - **적용 규모**: ${krasMeta.applicableScale.join(", ")}`,
        `> - **상세 절차**: \`get_kras_method({method: "${krasMeta.code}"})\` 호출 권장`,
        `> - **출처**: KOSHA KRAS (https://portal.kosha.or.kr/kras/evaluation/kras-method)`,
        "",
        "---",
        "",
      ].join("\n");
      md = krasHeader + md;
    }
  }

  return {
    content: [{ type: "text", text: md }],
    structuredContent: {
      query: input,
      schema,
      krasMethod: krasMeta,
    },
  };
}

export const getRiskAssessmentSchemaTool: ToolDefinition = {
  name: "get_risk_assessment_schema",
  title: "위험성평가서 스키마",
  description:
    "위험성평가서 작성을 위한 법정 필수 필드·구조를 Markdown 으로 반환. 산안법 §36(시행 2026-08-01) + 시행규칙 §37·§37의2·§37의3·§37의4 + 위험성평가 고시 제2024-76호 기반 — 실시 전 일정 고지, 실시 후 4개 항목 공유, 참여 근로자·근로자대표 기록 등 2026 개정 의무를 포함합니다. type 으로 최초·정기·수시·상시 선택, kras_method 로 KRAS 7방법 선택. LLM 은 이 스키마의 🔴 필수 필드를 반드시 채워 초안 작성. 법령 조문은 `get_safety_law_article` 로 인용·검증.",
  inputSchema,
  handler,
};
