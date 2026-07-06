import { useState } from "react";
import JournalHero from "../components/JournalHero";
import FeaturedArticle from "../components/FeaturedArticle";
import ArticleGrid from "../components/ArticleGrid";
import Cta from "../components/Cta";

export default function Resources() {
  const [category, setCategory] = useState("All articles");
  const [search, setSearch] = useState("");

  return (
    <>
      <JournalHero
        activeCategory={category}
        onCategoryChange={setCategory}
        searchValue={search}
        onSearchChange={setSearch}
      />
      <section className="w-full flex flex-col items-center bg-grey-100 px-4 sm:px-6 lg:px-12 pb-16 lg:pb-24">
        <div className="w-full max-w-[1200px] flex flex-col gap-8">
          <FeaturedArticle />
          <ArticleGrid />
        </div>
      </section>
      <Cta />
    </>
  );
}
