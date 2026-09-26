import { createApp } from "./app";

const port = Number(process.env.PORT) || 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`tech-abuse-patterns-ms listening on port ${port}`);
});
