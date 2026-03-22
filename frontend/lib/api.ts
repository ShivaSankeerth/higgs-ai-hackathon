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

export async function fetchParams(): Promise<ScenarioParams> {
  const res = await fetch(`${API_URL}/params`);
  if (!res.ok) throw new Error("Failed to fetch params");
  return res.json();
}

export async function submitForm(data: FormData): Promise<{ message: string }> {
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

export async function analyzeConversation(): Promise<{ analysis: CallAnalysis }> {
  const res = await fetch(`${API_URL}/analyze_conversation`);
  if (!res.ok) throw new Error("Failed to analyze conversation");
  return res.json();
}

export function createWebSocket(): WebSocket {
  return new WebSocket(WS_URL);
}
