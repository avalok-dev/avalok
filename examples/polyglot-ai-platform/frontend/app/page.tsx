const apiUrl = "http://api:8000/chat";

export async function askResearchAgent(prompt: string) {
  return fetch(apiUrl, { method: "POST", body: JSON.stringify({ prompt }) });
}

export default function Page() {
  return <main>Polyglot research platform</main>;
}
