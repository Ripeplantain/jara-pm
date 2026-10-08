import { THEME_KEY } from "@/components/shell/theme-toggle";

/**
 * Applies the stored theme before the first paint, so a dark-mode user never sees a white
 * flash. It has to be inline and synchronous for that; everything else about theming is CSS.
 */
export function ThemeScript() {
  const script = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
