import { ChatPage } from "./ChatPage";
import { FooterBar } from "./FooterBar";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <ChatPage />
      <FooterBar />
    </div>
  );
}
