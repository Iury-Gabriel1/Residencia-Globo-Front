export type Category = 'Cidade' | 'Previsão do tempo' | 'Economia' | 'Política' | 'Cultura' | 'Notícia séria' | 'Falecimento' | 'Conteúdo leve'
export type AlertLevel = 'none' | 'attention' | 'critical'
export interface Page { id: string; title: string; label: string; text: string; secondary?: string; keywords: string[] }
export interface Story { id: string; code: string; headline: string; category: Category; tone: string; guidance: string; alertLevel?: AlertLevel; pages: Page[] }
