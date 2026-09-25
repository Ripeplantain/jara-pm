import Link from "next/link";

export default function BoardNotFound() {
  return (
    <main className="simple-state">
      <h1>Board not found</h1>
      <p>
        It may have been deleted. <Link href="/">Back to your boards</Link>
      </p>
    </main>
  );
}
