const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/stream";

export interface ScenarioParams {
  user: {
    prospect: Record<string, string[]>;
    deal: Record<string, string[]>;
  };
  system: Record<string, Record<string, string[]>>;
}

export interface FormData {
  prospect_role: string;
  industry: string;
  objection_type: string;
  deal_stage: string;
  mood: string;
  gender: string;
}

export interface ConversationLog {
  role: string;
  timestamp: number;
  audio: string;
  transcription: string;
}

export interface DimensionScore {
  name: string;
  score: number;
  feedback: string;
}

export interface ImprovementPoint {
  dimension: string;
  point: string;
}

export interface CallAnalysis {
  overall_score: number;
  dimensions: DimensionScore[];
  improvements: ImprovementPoint[];
  highlights: string[];
}

export interface SessionSummary {
  id: number;
  prospect_role: string;
  industry: string;
  objection_type: string;
  deal_stage: string;
  mood: string;
  gender: string;
  created_at: number;
  status: "in_progress" | "completed" | "abandoned";
  turn_count: number;
  has_analysis: 0 | 1;
}

export interface SessionDetail {
  session: SessionSummary;
  turns: { role: string; transcription: string; timestamp: number }[];
  analysis: CallAnalysis | null;
}

export async function fetchParams(): Promise<ScenarioParams> {
  const res = await fetch(`${API_URL}/params`);
  if (!res.ok) throw new Error("Failed to fetch params");
  return res.json();
}

export interface ProspectBrief {
  scenario_params: Record<string, string>;
  prospect_role: string;
  prospect_name: string;
  prospect_company: string;
}

export async function submitForm(data: FormData): Promise<{ message: string; session_id: number } & ProspectBrief> {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => form.append(k, v));
  const res = await fetch(`${API_URL}/submit_form`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Failed to start simulation");
  return res.json();
}

export async function getConversation(): Promise<{ data: ConversationLog[] }> {
  const res = await fetch(`${API_URL}/get_conversation`);
  if (!res.ok) throw new Error("Failed to get conversation");
  return res.json();
}

export async function analyzeConversation(): Promise<{ analysis: CallAnalysis }> {
  const res = await fetch(`${API_URL}/analyze_conversation`);
  if (!res.ok) throw new Error("Failed to analyze conversation");
  return res.json();
}

export async function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  const res = await fetch(`${API_URL}/sessions`);
  if (!res.ok) throw new Error("Failed to list sessions");
  return res.json();
}

export async function getSessionDetail(id: number): Promise<SessionDetail> {
  const res = await fetch(`${API_URL}/sessions/${id}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export async function getSessionAnalysis(id: number): Promise<{ analysis: CallAnalysis }> {
  const res = await fetch(`${API_URL}/sessions/${id}/analysis`);
  if (!res.ok) throw new Error("Failed to get analysis");
  return res.json();
}

export function createWebSocket(): WebSocket {
  return new WebSocket(WS_URL);
}
