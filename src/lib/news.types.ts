export interface NewsItem {
  id: string;
  source: string;
  category: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  image?: string;
  imageCandidates?: string[];
  imageStatus?: "original" | "search" | "provisional";
  imageCandidates?: string[];
}
