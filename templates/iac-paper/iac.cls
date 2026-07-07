%% iac.cls
%% Copyright 2026 Toby Rahloff
%%
%% This work may be distributed and/or modified under the conditions of the
%% LaTeX Project Public License, either version 1.3c of this license or (at
%% your option) any later version. The latest version of this license is in
%%   https://www.latex-project.org/lppl.txt
%% and version 1.3c or later is part of all distributions of LaTeX version
%% 2008 or later.
%%
%% This work has the LPPL maintenance status `maintained'.
%% The Current Maintainer of this work is Toby Rahloff.
%%
%% This is an UNOFFICIAL, clean-room implementation of the formatting required
%% by the IAF/IAC manuscript guidelines. It is not affiliated with or endorsed
%% by the International Astronautical Federation.
%%
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{iac}[2026/06/30 v0.1.0 IAC manuscript class (unofficial)]

% ---- Class options -------------------------------------------------------
\newif\ifiacAfour
\newif\ifiacNobib
\DeclareOption{a4}{\iacAfourtrue}
\DeclareOption{nobib}{\iacNobibtrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax

\LoadClass[twocolumn,10pt]{article}

\RequirePackage{iftex}

% ---- Page geometry -------------------------------------------------------
% US Letter is the default per the IAC guidelines. The [a4] option applies the
% guideline A4 margins (>= 2.25 cm left/right, >= 3.35 cm top/bottom).
\ifiacAfour
  \RequirePackage[a4paper,top=3.35cm,bottom=3.35cm,left=2.25cm,right=2.25cm]{geometry}
\else
  \RequirePackage[letterpaper,margin=2.0cm]{geometry}
\fi
\setlength{\columnsep}{0.6cm}

% ---- Fonts: Times New Roman, 10 pt, on every engine ----------------------
% pdfLaTeX -> newtx (Times clone); XeLaTeX/LuaLaTeX -> TeX Gyre Termes via
% fontspec, with matching math.
\ifPDFTeX
  \RequirePackage[T1]{fontenc}
  \RequirePackage[utf8]{inputenc}
  \RequirePackage{newtxtext,newtxmath}
\else
  \RequirePackage{fontspec}
  % Load TeX Gyre Termes (Times-compatible) by FILE so it resolves without a
  % system font-name database (robust on XeTeX and LuaTeX, fresh TeX Live).
  \setmainfont{texgyretermes}[
    Extension      = .otf,
    UprightFont    = *-regular,
    BoldFont       = *-bold,
    ItalicFont     = *-italic,
    BoldItalicFont = *-bolditalic ]
  \RequirePackage{unicode-math}
  \setmathfont{texgyretermes-math.otf}
\fi

\RequirePackage{xstring}

% ---- Section heading styles ---------------------------------------------
% Section headings bold, flush-left; subsection/sub-subsection italic,
% flush-left; all numbered (Nomenclature/Acronyms are unnumbered, below).
\RequirePackage{titlesec}
\titleformat{\section}{\normalfont\bfseries}{\thesection.}{0.5em}{}
\titleformat{\subsection}{\normalfont\itshape}{\thesubsection.}{0.5em}{}
\titleformat{\subsubsection}{\normalfont\itshape}{\thesubsubsection.}{0.5em}{}
\titlespacing*{\section}{0pt}{1.2em}{0.4em}
\titlespacing*{\subsection}{0pt}{0.8em}{0.3em}
\titlespacing*{\subsubsection}{0pt}{0.6em}{0.3em}

% ---- Unnumbered front-matter sections -----------------------------------
\newcommand{\nomenclature}[1]{\section*{Nomenclature}#1}
\newcommand{\acronyms}[1]{\section*{Acronyms/Abbreviations}#1}

% ---- Manuscript metadata -------------------------------------------------
\newcommand{\iacConference}{}
\newcommand{\iacLocation}{}
\newcommand{\iacDates}{}
\newcommand{\iacYear}{}
\newcommand{\iacPaperNumber}{}
\newcommand{\IACconference}[1]{\renewcommand{\iacConference}{#1}}
\newcommand{\IAClocation}[1]{\renewcommand{\iacLocation}{#1}}
\newcommand{\IACdates}[1]{\renewcommand{\iacDates}{#1}}
\newcommand{\IACyear}[1]{\renewcommand{\iacYear}{#1}}
\newcommand{\IACpapernumber}[1]{\renewcommand{\iacPaperNumber}{#1}}

% Two-digit year (e.g. 2026 -> 26) for the paper-number prefix.
\newcommand{\iacYYtwo}{\IfStrEq{\iacYear}{}{}{\StrRight{\iacYear}{2}}}

% ---- Abstract (rendered full width by \maketitle) ------------------------
\newcommand{\iacAbstract}{}
\renewcommand{\abstract}[1]{\renewcommand{\iacAbstract}{#1}}

% Author block is defined below; default to a no-op so the title compiles
% before \IACauthor is used.
\providecommand{\iacMakeAuthors}{}

% ---- Authors and affiliations -------------------------------------------
% \IACauthor*[orcid=...]{Name}{Affiliation, City, Country}{email}
%   *  marks the corresponding author (adds a corresponding-author note).
%   Identical affiliation strings automatically share one superscript number.
\newcounter{iac@naff}
\newcommand{\iac@authornames}{}
\newcommand{\iac@afflist}{}
\newcommand{\iac@correspemail}{}
\newif\ifiac@firstauthor \iac@firstauthortrue

% Find affiliation #1 among stored ones; set \iac@thisaffnum. Register if new.
\newcommand{\iac@findaff}[1]{%
  \edef\iac@thisaffnum{0}%
  \count255=1\relax
  \@whilenum\count255<\numexpr\value{iac@naff}+1\relax\do{%
    \edef\iac@stored{\csname iac@aff@\the\count255\endcsname}%
    \IfStrEq{\iac@stored}{#1}{\edef\iac@thisaffnum{\the\count255}}{}%
    \advance\count255 by 1\relax
  }%
  \ifnum\iac@thisaffnum=0\relax
    \stepcounter{iac@naff}%
    \expandafter\gdef\csname iac@aff@\arabic{iac@naff}\endcsname{#1}%
    \edef\iac@thisaffnum{\arabic{iac@naff}}%
    \ifnum\value{iac@naff}=1\relax
      \protected@edef\iac@affentry{\noexpand\textsuperscript{\iac@thisaffnum}\unexpanded{#1}}%
    \else
      \protected@edef\iac@affentry{\noexpand\\\noexpand\textsuperscript{\iac@thisaffnum}\unexpanded{#1}}%
    \fi
    \expandafter\g@addto@macro\expandafter\iac@afflist\expandafter{\iac@affentry}%
  \fi
}

\NewDocumentCommand{\IACauthor}{s o m m m}{%
  \iac@findaff{#4}%
  \IfBooleanTF{#1}{\def\iac@star{,*}\gdef\iac@correspemail{#5}}{\def\iac@star{}}%
  \protected@edef\iac@entry{\unexpanded{#3}\noexpand\textsuperscript{\iac@thisaffnum\iac@star}}%
  \ifiac@firstauthor
    \iac@firstauthorfalse
  \else
    \g@addto@macro\iac@authornames{, }%
  \fi
  \expandafter\g@addto@macro\expandafter\iac@authornames\expandafter{\iac@entry}%
}

\renewcommand{\iacMakeAuthors}{%
  \ifx\iac@authornames\@empty\else
    {\large\iac@authornames\par}%
    \vskip 0.6em
    {\footnotesize\iac@afflist\par}%
    \ifx\iac@correspemail\@empty\else
      \vskip 0.4em
      {\footnotesize\textsuperscript{*}Corresponding author: \iac@correspemail\par}%
    \fi
  \fi
}

% ---- Title block (paper number + full-width title and abstract) ----------
\renewcommand{\maketitle}{%
  \twocolumn[%
    \begin{@twocolumnfalse}%
      \begingroup
        \centering
        {\normalsize\textbf{IAC-\iacYYtwo-\iacPaperNumber}\par}%
        \vskip 1.0em
        {\LARGE \@title \par}%
        \vskip 0.8em
        \iacMakeAuthors
        \vskip 1.2em
      \endgroup
      \ifx\iacAbstract\@empty\else
        {\noindent\textbf{Abstract}\par\vskip 0.3em
         \noindent\iacAbstract\par}\vskip 1.5em
      \fi
    \end{@twocolumnfalse}%
  ]%
  \thispagestyle{iac@firstpage}%
}

% ---- Copyright + page footer --------------------------------------------
\RequirePackage{lastpage}
\RequirePackage{fancyhdr}

% Default footer copyright: the IAF congress auto-stamp built from metadata.
\newcommand{\iac@copyrightline}{%
  International Astronautical Congress -- IAC~\iacYear, \iacLocation, \iacDates~\iacYear.
  Copyright \textcopyright~\iacYear\ by the International Astronautical Federation (IAF). All rights reserved.}

% \IACcopyright[FORM]{holder}{year}; FORM in {A,B1,B2,C}; omit for the default
% congress stamp. Wording per the IAC 2026 Manuscript Guidelines, pp. 7-8.
\NewDocumentCommand{\IACcopyright}{O{default} m m}{%
  \IfStrEqCase{#1}{%
    {A}{\renewcommand{\iac@copyrightline}{Copyright \textcopyright~#3 by the International Astronautical Federation. All rights reserved.}}%
    {B1}{\renewcommand{\iac@copyrightline}{Copyright \textcopyright~#3 by #2. Published by the IAF, with permission and released to the IAF to publish in all forms.}}%
    {B2}{\renewcommand{\iac@copyrightline}{Copyright \textcopyright~#3 by #2. Published by the IAF, with permission and released to the IAF to publish in all forms.}}%
    {C}{\renewcommand{\iac@copyrightline}{Copyright \textcopyright~#3 by #2. Government work; released to the IAF to publish in all forms, subject to the applicable national regulations.}}%
    {default}{}%
  }%
}

\newcommand{\iac@footinfo}{IAC-\iacYYtwo-\iacPaperNumber\quad Page~\thepage\ of~\pageref{LastPage}}
\fancypagestyle{iac@firstpage}{%
  \fancyhf{}%
  \renewcommand{\headrulewidth}{0pt}\renewcommand{\footrulewidth}{0pt}%
  \fancyfoot[C]{\footnotesize\parbox{\textwidth}{\centering\iac@copyrightline\\[2pt]\iac@footinfo}}%
}
\fancypagestyle{iac@otherpages}{%
  \fancyhf{}%
  \renewcommand{\headrulewidth}{0pt}\renewcommand{\footrulewidth}{0pt}%
  \fancyfoot[C]{\footnotesize\iac@footinfo}%
}
\setlength{\footskip}{34pt}
\AtBeginDocument{\pagestyle{iac@otherpages}}

% ---- Bibliography (biblatex + biber, IAC style) -------------------------
% Loaded by default; pass [nobib] to the class to use a different bibliography
% mechanism (e.g. natbib/bibtex) or none.
\ifiacNobib\else
  \RequirePackage[backend=biber,style=iac,sorting=none]{biblatex}
\fi

\endinput
