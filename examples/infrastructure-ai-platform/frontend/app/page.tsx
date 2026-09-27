export default async function Page() {
  const response = await fetch("http://research-api:8000/health");
  return <main>Research platform: {response.status}</main>;
}
