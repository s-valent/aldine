# Custom compiler: prebuilt Aldine compiler + packages/fonts for Russian
# documents (pdflatex + XeLaTeX, polyglossia/fontspec, biblatex, the phd repo).
FROM ghcr.io/trahloff/aldine-compiler:latest

# Cyrillic (T2A) + russian babel/hyphenation; rebuild only the needed formats.
# Live tlnet mirror: the texlive.info snapshot the base image pins is unreachable.
RUN tlmgr option repository https://mirror.ctan.org/systems/texlive/tlnet \
    && tlmgr install cyrillic babel-russian hyphen-russian lh \
    && fmtutil-sys --byfmt pdflatex && fmtutil-sys --byfmt xelatex && fmtutil-sys --byfmt lualatex

# algorithm2e dependencies (xspace ships with the base latex package)
RUN tlmgr install ifoddpage

# Packages the medium scheme omits, used by the phd repo (XeLaTeX) and pdflatex.
# cm-unicode provides the CMU OTF fonts used as the fontspec fallback family.
RUN tlmgr install \
    pgfplots circuitikz tabularray tabulary totpages totcount totalcount \
    makecell comment aliascnt xcharter newtx draftwatermark csquotes \
    savetrees booklet esint appendixnumberbeamer was relsize mdframed \
    gitinfo2 nomencl cm-unicode

# System fonts for fontspec/XeLaTeX: Times New Roman family (default in the phd
# template), Liberation family, Courier New, Arial. ttf-mscorefonts-installer
# downloads from sourceforge, so tolerate failure (template falls back to CMU).
RUN printf 'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: testing testing-updates\nComponents: contrib non-free\nSigned-By: /usr/share/keyrings/debian-archive-keyring.pgp\n' > /etc/apt/sources.list.d/nonfree.sources \
    && apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fonts-liberation \
    && echo ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true | debconf-set-selections \
    && (DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ttf-mscorefonts-installer || true) \
    && fc-cache -f
