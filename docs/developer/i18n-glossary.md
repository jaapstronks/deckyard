# Locale glossary

This is the canonical source for reviewed locale terminology and style. Each locale below has seven reviewed analytics concepts; these entries do not claim a review of the rest of that locale.

The analytics title names the same feature on the dashboard, in deck settings and in instance administration. The chart description is the accessible name of both views-over-time bar charts, whether rendered with CSS or SVG.

## en

| English concept                   | Canonical text                    | Context and keys                                                                                                                                      |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Engagement Insights               | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Bar chart showing views over time | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Completion                        | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Total Views                       | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unique Viewers                    | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Views                             | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Views Over Time                   | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## nl

| English concept                   | Canonical text                        | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Engagement-inzichten                  | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Staafdiagram met weergaven in de tijd | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Voltooiing                            | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Totaal weergaven                      | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unieke kijkers                        | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Weergaven                             | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Weergaven in de tijd                  | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

### Dutch style

Dutch here borrows English freely; don't over-translate product vocabulary.

| Use                             | Not                     |
| ------------------------------- | ----------------------- |
| slide, slides                   | dia, dia's              |
| slide-type, slide-bibliotheek   | diatype, diabibliotheek |
| reactie (a comment)             | opmerking               |
| antwoord (a reply to a comment) | reactie                 |
| organization, lead, analytics   | werkruimte, …           |
| detailregel (title slide)       | meta                    |
| kanttekening (the aside inset)  | terzijde                |
| op je telefoon (notes on phone) | notities (QR)           |

The English words for the last three rows are **Detail line**, **Side note** and **On your phone**; every locale names those concepts with one word of its own, never the schema key or the mechanism (D352).

Address the user informally (`je` / `jouw`, never `u`), use infinitives for action labels (Opslaan, Annuleren, Verwijderen), and sentence case for headings; Dutch does not capitalize every word.

## da

| English concept                   | Canonical text                       | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Indsigt i engagement                 | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Søjlediagram over visninger over tid | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Fuldførelse                          | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Visninger i alt                      | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unikke seere                         | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Visninger                            | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Visninger over tid                   | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## de

| English concept                   | Canonical text                            | Context and keys                                                                                                                                      |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Engagement-Einblicke                      | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Säulendiagramm der Aufrufe im Zeitverlauf | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Abschluss                                 | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Aufrufe gesamt                            | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Eindeutige Betrachter                     | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Aufrufe                                   | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Aufrufe im Zeitverlauf                    | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## es

| English concept                   | Canonical text                                         | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Datos de interacción                                   | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Gráfico de barras con las vistas a lo largo del tiempo | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Finalización                                           | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Vistas totales                                         | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Espectadores únicos                                    | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Vistas                                                 | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Vistas a lo largo del tiempo                           | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## fi

| English concept                   | Canonical text                             | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Sitoutumisanalyysi                         | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Pylväskaavio katselukerroista ajan mittaan | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Loppuun katsotut                           | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Katselukertoja yhteensä                    | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Yksilölliset katsojat                      | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Katselukerrat                              | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Katselukerrat ajan mittaan                 | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## fr

| English concept                   | Canonical text                             | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Aperçu de l'engagement                     | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Diagramme en barres des vues dans le temps | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Achèvement                                 | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Vues totales                               | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Spectateurs uniques                        | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Vues                                       | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Vues dans le temps                         | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## it

| English concept                   | Canonical text                                  | Context and keys                                                                                                                                      |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Analisi del coinvolgimento                      | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Grafico a barre delle visualizzazioni nel tempo | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Completamento                                   | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Visualizzazioni totali                          | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Spettatori unici                                | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Visualizzazioni                                 | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Visualizzazioni nel tempo                       | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## no

| English concept                   | Canonical text                       | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Engasjementsinnsikt                  | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Søylediagram over visninger over tid | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Fullføring                           | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Visninger totalt                     | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unike seere                          | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Visninger                            | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Visninger over tid                   | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## pl

| English concept                   | Canonical text                      | Context and keys                                                                                                                                      |
| --------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Analiza zaangażowania               | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Wykres słupkowy wyświetleń w czasie | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Ukończenie                          | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Łączna liczba wyświetleń            | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unikalni widzowie                   | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Wyświetlenia                        | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Wyświetlenia w czasie               | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## pt

| English concept                   | Canonical text                                           | Context and keys                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Dados de interação                                       | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Gráfico de barras com as visualizações ao longo do tempo | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Conclusão                                                | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Visualizações totais                                     | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Espectadores únicos                                      | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Visualizações                                            | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Visualizações ao longo do tempo                          | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |

## sv

| English concept                   | Canonical text                        | Context and keys                                                                                                                                      |
| --------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement Insights               | Engagemangsinsikter                   | Feature title: `dashboard.title`, `editor.deckSettings.analytics.title`, `settings.admin.analytics.title`.                                            |
| Bar chart showing views over time | Stapeldiagram över visningar över tid | Accessible chart name: `analytics.chartAriaLabel`, `dashboard.chart.ariaLabel`.                                                                       |
| Completion                        | Slutförande                           | Sessions reaching the final slide as a percentage of all sessions; the value carries %. Keys: `analytics.completionRate`, `dashboard.top.completion`. |
| Total Views                       | Visningar totalt                      | View-session count for a deck or the accessible deck set. Keys: `analytics.totalViews`, `dashboard.cards.totalViews`.                                 |
| Unique Viewers                    | Unika tittare                         | Distinct COALESCE(device_id, id::text), not identified people. Keys: `analytics.uniqueViewers`, `dashboard.cards.uniqueViewers`.                      |
| Views                             | Visningar                             | Generic view count; the row identifies a slide or a deck. Keys: `analytics.views`, `dashboard.top.views`.                                             |
| Views Over Time                   | Visningar över tid                    | Views grouped by day. Keys: `analytics.viewsOverTime`, `dashboard.chart.title`.                                                                       |
