import ArticleHero from "../components/ArticleHero";
import ArticleContent from "../components/ArticleContent";
import RelatedReading from "../components/RelatedReading";
import Cta from "../components/Cta";

export default function Article() {
  return (
    <>
      <ArticleHero />
      <ArticleContent />
      <RelatedReading />
      <Cta />
    </>
  );
}
