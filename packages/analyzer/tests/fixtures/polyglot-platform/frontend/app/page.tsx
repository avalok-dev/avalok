export async function ask(prompt: string) {
  return fetch("http://api:8000/chat", { method: "POST", body: JSON.stringify({ prompt }) });
}

export default function Page() {
  return <main>Research platform</main>;
}
