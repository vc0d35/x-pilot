/** One entry of an X sidebar widget: a trend or a headline, plus the line X shows under it. */
export interface WidgetItem { title: string; detail: string }
export interface WidgetSection { heading: string; items: WidgetItem[] }
