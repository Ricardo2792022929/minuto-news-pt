export interface StorySource {
  source: string;
  title: string;
  url: string;
  publishedAt: string;
}

export interface NewsItem {
  id: string;
  source: string;
  category: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  image?: string;
  imageStatus?: "original" | "search" | "provisional";
  imageCandidates?: string[];
  originalTitle?: string;
  sources?: StorySource[];
}
