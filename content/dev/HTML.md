---
title: HTML
date: 2024-09-05
draft: true
tags:
banner:
cssclasses:
description:
permalink:
aliases:
completed:
---
HTML 기본

- 프로그래밍 언어가 아닌 마크업 언어로 웹페이지를 표현하기 위한 규약(HyperText Markup Language)
- 어느 정도의 문법적 오류는 신경쓰지 않기 때문에, 웹페이지가 정상적으로 출력되더라도 오류가 있을 수 있음
- 약속된 표기법을 태그(tag)라고 부르며 <와>를 이용해 구분하며 소문자를 권장
- 태그는 속성과 함께 사용할 수 있음
- tag + content = element

## 기본 형태

```HTML
<!DOCTYPE html> <!-- 문서 유형 지정 선언문 -->
<html lang="ko"> <!-- 웹 문서 시작 태그, 문서에 사용될 언어 지정(검색 or 화면낭독기) -->
<head> <!-- 브라우저에 정보를 주는 태그 -->
    <meta charset="UTF-8"> <!-- 문자 세트 지정 -->
    <meta http-equiv="X-UA-Compatible" content="IE=edge"> <!-- 인터넷 익스플로러 브라우저 고려 -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0"> <!-- 모바일 기기 고려 -->
    
    <meta name="keywords" content="문서의 키워드1, 키워드2"> <!-- 검색엔진을 위한 부분 -->
    <meta name="description" content="해당 문서의 설명">
    <meta name="author" content="문서의 소유자 또는 저자">

    <!-- CSS 문서 참조 -->
    <link rel="stylesheet" href="경로/스타일시트.css">

    <!-- 파비콘, rel 속성은 아래 중 택일(우선순위 높은순) -->
    <!-- shortcut icon, icon, default icon, apple-touch-icon, apple-touch-icon-precomposed -->
    <link rel="shortcut icon" href="경로/파비콘.ico" /> 

    <title>Document</title> <!-- 타이틀 -->

</head>
<body> <!-- 실제 브라우저에 표시될 내용 -->
    hello world!
</body>
</html> <!-- 웹 문서 종료 태그 -->
```

---

  

  

# 학습방법

- 통계에 의해 자주 사용하는 태그위주로 공부할 것
    
    > [!info] World's longest standing rank tracking tool - Advanced Web Ranking  
    > Advanced Web Ranking provides fresh daily, weekly or on demand geo-located rankings.  
    > [https://www.advancedwebranking.com/](https://www.advancedwebranking.com/)  
    

  

- google it, 모든 내용을 한번에 습득하기 보다 개괄적인 내용을 습득하고 추후에 검색을 활용할 것

  

  

# 레이아웃

- HTML (semantic) 요소, div를 활용한 방법이 있음
- table 은 데이터를 위한 태그로 레이아웃 용도로는 적합하지 않음

  

## semantic 요소 활용

```HTML
<header><h2>Header 영역</h2></header>

<nav><h2>Nav 영역</h2></nav>

<section><p>Section 영역</p></section>

<footer><h2>Footer 영역</h2></footer>
```

![[/Untitled 6.png|Untitled 6.png]]

출처 : [http://tcpschool.com/html/html_space_layouts](http://tcpschool.com/html/html_space_layouts)

![[스크린샷_2021-09-04_오전_10.37.44.png]]

출처 : [http://tcpschool.com/html/html_space_layouts](http://tcpschool.com/html/html_space_layouts)

## div 태그 활용

```HTML
<div id="header"><h2>Header 영역</h2></div>

<div id="nav"><h2>Nav 영역</h2></div>

<div id="section"><p>Section 영역</p></div>

<div id="footer"><h2>Footer 영역</h2></div>
```

  

# Block level 과 Inline level

- block level 은 항상 새로운 line에서 시작
- block 요소 : div, form, ol, ul, table, h1~6, p, blockquote, header, footer 등

  

- Inline level 은 새로운 line에서 시작하지 않음
- inline 요소 : a, br, button, img, span 등  
    note :  
    _inline 요소는 block 요소를 담을 수 없음!_

  

  

# 주요 Tags

## 텍스트 관련

```HTML
<!-- Block level -->
<h1>제목1</h1> <!-- h1 ~ h6 -->
<p>단락</p>
<br> <!-- 줄바꿈 -->
<hr> <!-- 구분선 -->
<blockquote>인용문</blockquote>
<ol><li>목록 - ordered</li></ol>
<ul><li>목록 - unordered</li></ul>

<table>
    <caption>수학 성적</caption> <!-- caption-side: bottom -->
    <thead>
        <tr>
            <th>학반</th>
            <th>이름</th>
            <th>점수</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>1</td>
            <td>김영득</td>
            <td>90</td>
        </tr>
        <tr>
            <td>2</td>
            <td>이갑자</td>
            <td>80</td>
        </tr>
    </tbody>
    <tfoot>
        <tr>
            <th colspan="2">평균</th> <!-- rowspan -->
            <th>85</th>
        </tr>
    </tfoot>
</table>
<!-- Inline level -->
<strong>bold체 - 낭독기 강조</strong>
<b>bold체 - 낭독기 강조 안함</b>
<em>기울임꼴 - emphasis, 강조</em>
<i>기울임꼴 - italic, 관용구</i>
<q>인용 - 따옴표로 구분</q>
<mark>형광펜</mark>
<span>영역묶기 - 스타일 적용에 활용</span>
```

## 이미지 & 하이퍼링크

```Bash
<figure>
    <img src="../상위경로이미지.svg" alt="엑박시 설명">
    <figcaption>이미지 설명</figcaption>
</figure>


<map name="primary">
    <area shape="circle" coords="75,75,75" href="left.html">
    <area shape="circle" coords="275,75,75" href="right.html">
</map>
<img usemap="\#primary" src="https://via.placeholder.com/350x150" alt="350 x 150 pic">


<a href="https://taedi.net" target="_blank">사이트 바로가기</a>
<a href="\#id">앵커태그에 id활용 가능</a>
```

## table

```HTML
<table>
    <caption>수학 성적</caption> <!-- caption-side: bottom -->
    <thead>
        <tr>
            <th>학반</th>
            <th>이름</th>
            <th>점수</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>1</td>
            <td>김영득</td>
            <td>90</td>
        </tr>
        <tr>
            <td>2</td>
            <td>이갑자</td>
            <td>80</td>
        </tr>
    </tbody>
    <tfoot>
        <tr>
            <th colspan="2">평균</th> <!-- rowspan -->
            <th>85</th>
        </tr>
    </tfoot>
</table>
```

## form 관련

```HTML
<div id="wrap_apply">

    <h1>프런트 엔드 개발자 지원서</h1>
    <p>HTML, CSS, Javascript에 대한 기술적 이해와 경험이 있는 분을 찾습니다.</p>
    <hr><br>

    <form action="result.html" method="POST">
        <div>
            <div class="label_col">
                <label for="username">이름</label>
            </div>
            <div class="input_col">
                <input type="text" name="username" placeholder="공백없이 입력하세요" required autofocus minlength="2">
            </div>
        </div>

        <div>
            <div class="label_col">
                <label for="phone">연락처</label>
            </div>
            <div class="input_col">
                <input type="tel" name="phone" required maxlength="13">
            </div>
        </div>
        <br>

        <h3>지원 분야</h3>
        <div class="radiobox">
            <p><input type="radio" name="area" value="web"> 웹 퍼블리싱</p>
            <p><input type="radio" name="area" value="webapp"> 웹 어플리케이션 개발</p>
            <p><input type="radio" name="area" value="dev"> 개발환경 개선</p>
        </div>
        <br>

        <h3>지원 동기</h3>
        <textarea rows="5" name="comment" placeholder="본사 지원동기를 적어보시라요" ></textarea>
        <button type="submit">제출하기</button>
        <button type="reset">다시쓰기</button>

    </form>
</div>
```

  

# Emmet 활용하기

Emmet을 활용하면 좀 더 편하게 코드를 작성할 수 있다.

```HTML
<!-- 기본 html 문서 -->
! or html

<!-- Child: > -->
div>ul>li

<!-- Sibling: + -->
div+p+bq

<!-- Climb-up: ^ -->
div+div>p>span+em^^^bq

<!-- Multiplication: * -->
ul>li*5

<!-- Grouping: () -->
div>(header>ul>li*2>a)+footer>p

<!-- ID: #  & CLASS: . -->
div\#header+div.page+div\#footer.class1.class2.class3

<!-- Custom attributes: [] -->
td[title="Hello world!" colspan=3]

<!-- Item numbering: $ -->
ul>li.item$*5

<!-- Text: {} -->
a[href="https://taedi.net"]{Click me}
```

- 문법 상세  
      
    [https://docs.emmet.io/abbreviations/syntax/](https://docs.emmet.io/abbreviations/syntax/)

  

  

# id, class, name, value 속성???

### **id 속성**

**고유한** 식별을 목적으로 하는 경우 사용

### **class 속성**

재사용을 목적으로 하는 경우 사용(여러 요소에 동일한 스타일을 적용시킬 경우)

### **name 속성**

form 컨트롤 요소의 값(`value`)을 서버로 전송하기 위해 필요한 속성

  

  

  

  

# 알아봐야할 내용

---

- [ ] input
- [ ] id는 하나하나 고유값을 가져야하고 class는 여러 태그에 붙일 수 있다.
- [ ] id를 앵커태그에 활용할 수 있다.
- [ ] box & items

  

  

  

## References

---

- w3school

[https://www.w3schools.com](https://www.w3schools.com/)

- MDN

[https://developer.mozilla.org/en-US/](https://developer.mozilla.org/en-US/)

- jsbin

[https://jsbin.com/](https://jsbin.com/)

- Material Design Color Tool(색조합)

[https://material.io/resources/color/#!/?view.left=0&view.right=0](https://material.io/resources/color/#!/?view.left=0&view.right=0)

- html elements & attributes

[https://heropy.blog/2019/05/26/html-elements/](https://heropy.blog/2019/05/26/html-elements/)