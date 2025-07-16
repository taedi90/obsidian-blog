---
title: HTML 기본 구조
date: 2022-09-05
draft: false
tags:
  - html
  - web
  - frontend
  - semantic-web
banner: 
cssclasses: 
description: HTML의 기본 문서 구조, 블록과 인라인 요소의 차이, 웹 접근성과 SEO에 중요한 시맨틱 태그의 개념과 사용법을 정리한다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 1. 개요

<b>HTML(HyperText Markup Language)</b>은 웹 페이지의 콘텐츠와 구조를 정의하기 위한 <b>마크업 언어</b>다. 프로그래밍 언어처럼 복잡한 로직을 수행하는 것이 아니라, <b>태그(Tag)</b>라는 약속된 표기법을 사용하여 텍스트, 이미지, 비디오 등의 콘텐츠를 감싸고 그 의미와 구조를 부여하는 역할을 한다.

브라우저는 HTML 코드를 해석하여 사용자에게 시각적인 웹 페이지로 보여준다. 흥미로운 점은 HTML이 문법적으로 다소 관대하여 약간의 오류가 있더라도 브라우저가 최대한 페이지를 렌더링하려고 노력한다는 것이다. 하지만 이는 잠재적인 문제를 숨길 수 있으므로, 웹 표준에 맞는 정확한 마크업을 작성하는 습관이 매우 중요하다고 보았다.

이 문서는 HTML의 가장 기본적인 구조부터 웹 페이지의 레이아웃을 구성하는 방법, 검색 엔진 최적화(SEO)와 웹 접근성에 필수적인 <b>시맨틱 웹(Semantic Web)</b>의 개념까지 핵심적인 내용을 정리하는 것을 목표로 한다.

## 2. HTML 문서의 기본 구조

모든 HTML 문서는 아래와 같은 기본적인 구조를 가진다. 각 태그는 웹 브라우저와 검색 엔진에게 문서의 유형, 언어, 문자 인코딩 방식 등 중요한 정보를 전달한다.

```html
<!DOCTYPE html> <!-- 이 문서가 HTML5 표준에 따라 작성되었음을 선언 -->
<html lang="ko"> <!-- HTML 문서의 시작과 끝을 나타내며, 주 사용 언어를 명시 -->
<head> <!-- 브라우저에게 필요한 정보(메타데이터)를 담는 영역 -->
    <meta charset="UTF-8"> <!-- 문자 인코딩 방식을 UTF-8로 지정 -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> <!-- 모바일 기기에서 화면 배율을 설정 -->
    <meta name="description" content="이 페이지에 대한 간략한 설명"> <!-- 검색 엔진을 위한 설명 -->
    <link rel="stylesheet" href="style.css"> <!-- 외부 CSS 파일 연결 -->
    <link rel="shortcut icon" href="favicon.ico"> <!-- 파비콘(favicon) 설정 -->
    <title>문서 제목</title> <!-- 브라우저 탭에 표시될 제목 -->
</head>
<body> <!-- 사용자에게 실제로 보여질 모든 콘텐츠를 담는 영역 -->
    <h1>안녕하세요!</h1>
    <p>이곳에 웹 페이지의 내용이 들어갑니다.</p>
</body>
</html>
```

## 3. 블록(Block)과 인라인(Inline) 요소

HTML 요소는 크게 <b>블록 레벨 요소</b>와 <b>인라인 레벨 요소</b> 두 가지로 나뉜다. 이 둘의 가장 큰 차이는 화면에 표시될 때 차지하는 공간의 방식이다.

-   <b>블록 레벨 요소(Block-level elements)</b>
    -   항상 새로운 줄에서 시작하며, 사용 가능한 가로 너비 전체를 차지한다.
    -   `<div>`, `<p>`, `<h1>`~`<h6>`, `<ul>`, `<li>`, `<header>`, `<footer>` 등이 해당된다.

-   <b>인라인 레벨 요소(Inline-level elements)</b>
    -   새로운 줄에서 시작하지 않으며, 자신의 콘텐츠만큼의 너비만 차지한다.
    -   문장이나 단어 등 작은 부분에 스타일을 적용할 때 주로 사용된다.
    -   `<span>`, `<a>`, `<img>`, `<strong>`, `<em>` 등이 해당된다.

> [!IMPORTANT]
> 인라인 요소는 내부에 블록 레벨 요소를 포함할 수 없다. 예를 들어, `<a>` 태그 안에 `<div>` 태그를 넣는 것은 웹 표준에 어긋난다.

## 4. 시맨틱 웹(Semantic Web)과 레이아웃

과거에는 웹 페이지의 레이아웃을 `<div>` 태그만으로 구성하는 경우가 많았다. 하지만 이는 코드의 가독성을 떨어뜨리고, 검색 엔진이나 스크린 리더가 페이지의 구조를 이해하기 어렵게 만드는 문제가 있었다.

<b>시맨틱 HTML(Semantic HTML)</b>은 태그 자체가 자신의 콘텐츠가 어떤 의미를 가지는지 명확하게 설명해주는 것을 말한다. 예를 들어, `<div>` 대신 `<header>`, `<nav>`, `<main>`, `<footer>` 와 같은 시맨틱 태그를 사용하면, 브라우저와 개발자 모두가 해당 영역의 역할을 쉽게 파악할 수 있다.

-   <b>시맨틱 태그를 사용한 레이아웃 예시</b>
    ```html
    <header> <!-- 페이지 상단, 로고, 제목 등이 위치 -->
        <h1>My Website</h1>
    </header>
    <nav> <!-- 다른 페이지로 이동하는 내비게이션 링크 -->
        <ul>
            <li><a href="#">Home</a></li>
            <li><a href="#">About</a></li>
        </ul>
    </nav>
    <main> <!-- 페이지의 핵심적인 주요 콘텐츠 -->
        <section>
            <h2>Section Title</h2>
            <p>This is the main content.</p>
        </section>
    </main>
    <footer> <!-- 페이지 하단, 저작권, 연락처 정보 등이 위치 -->
        <p>&copy; 2024 My Website</p>
    </footer>
    ```

> [!NOTE]
> `<table>` 태그는 데이터를 표 형태로 표현하기 위한 시맨틱 태그다. 과거에는 레이아웃을 잡기 위해 사용되기도 했지만, 이는 태그의 본래 의미에 맞지 않는 사용법이므로 지양해야 한다.

## 5. 주요 태그(Tag) 정리

자주 사용되는 핵심 태그들을 기능별로 정리했다.

### 5-1. 텍스트 관련 태그

```html
<h1>가장 큰 제목</h1> <!-- h1부터 h6까지 있으며, 숫자가 클수록 글자 크기가 작아짐 -->
<p>이것은 하나의 문단(paragraph)입니다.</p>
<br> <!-- 줄바꿈(line break) -->
<hr> <!-- 주제 변경을 의미하는 수평선 -->
<blockquote>다른 곳에서 인용한 내용 블록</blockquote>
<ul><li>순서 없는 목록 (Unordered List)</li></ul>
<ol><li>순서 있는 목록 (Ordered List)</li></ol>
<strong>중요한 텍스트 (Bold)</strong>
<em>강조하는 텍스트 (Italic)</em>
<span>특별한 의미 없이 스타일 적용을 위해 묶는 인라인 컨테이너</span>
```

### 5-2. 이미지와 하이퍼링크

```html
<!-- 이미지 삽입. alt 속성은 이미지가 로드되지 않았을 때 표시될 대체 텍스트 -->
<img src="image.jpg" alt="이미지 설명">

<!-- 다른 페이지나 외부 사이트로 연결하는 하이퍼링크 -->
<!-- target="_blank"는 새 탭에서 링크를 열도록 함 -->
<a href="https://taedi.net" target="_blank">내 사이트로 가기</a>

<!-- 페이지 내부의 특정 id를 가진 요소로 이동 (앵커) -->
<a href="#section1">1번 섹션으로 이동</a>
```

### 5-3. 폼(Form) 관련 태그

사용자로부터 입력을 받기 위한 요소들이다. `name` 속성은 서버로 데이터를 전송할 때 키(key) 역할을 한다.

```html
<form action="/submit-data" method="post">
    <!-- 사용자가 텍스트를 입력할 수 있는 필드 -->
    <label for="username">이름:</label>
    <input type="text" id="username" name="user_name">

    <!-- 여러 개 중 하나만 선택 가능한 라디오 버튼 -->
    <input type="radio" id="html" name="fav_language" value="HTML">
    <label for="html">HTML</label>

    <!-- 여러 개 선택 가능한 체크박스 -->
    <input type="checkbox" id="vehicle1" name="vehicle1" value="Bike">
    <label for="vehicle1">I have a bike</label>

    <!-- 여러 줄의 텍스트를 입력받는 영역 -->
    <textarea name="message" rows="5"></textarea>

    <!-- 폼 데이터를 서버로 전송하는 버튼 -->
    <button type="submit">제출</button>
</form>
```

## 6. Emmet 활용하기

Emmet은 HTML과 CSS 코드를 매우 빠르고 효율적으로 작성할 수 있도록 도와주는 플러그인이다. 대부분의 최신 코드 에디터에 내장되어 있으며, 간단한 축약 문법을 통해 복잡한 HTML 구조를 한번에 생성할 수 있다.

-   `div>ul>li*3` → `<div><ul><li></li><li></li><li></li></ul></div>`
-   `div#header+div.content` → `<div id="header"></div><div class="content"></div>`
-   `a[href="#"]{Click Me}` → `<a href="#">Click Me</a>`

## 7. 참고 자료

-   <b>MDN Web Docs (Mozilla)</b>: 웹 기술에 대한 가장 신뢰할 수 있는 공식 문서
    -   [https://developer.mozilla.org/ko/docs/Web/HTML](https://developer.mozilla.org/ko/docs/Web/HTML)
-   <b>W3Schools</b>: 다양한 예제와 함께 웹 기술을 쉽게 학습할 수 있는 사이트
    -   [https://www.w3schools.com/html/](https://www.w3schools.com/html/)
-   <b>Emmet Documentation</b>: Emmet의 모든 문법과 사용법을 확인할 수 있는 공식 문서
    -   [https://docs.emmet.io/](https://docs.emmet.io/)
