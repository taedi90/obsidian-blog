---
title: CSS 기본 개념 정리 (선택자, 우선순위, Flexbox)
date: 2022-09-05
draft: false
tags:
  - css
  - frontend
  - web
  - selector
  - flexbox
banner: 
cssclasses: 
description: CSS의 기본 문법부터 선택자(Selector), 스타일 적용 우선순위(Specificity), 그리고 최신 레이아웃 기법인 Flexbox의 핵심 개념과 주요 속성을 체계적으로 정리한다.
permalink: 
aliases: 
completed: true
type:
  - note
---

## 1. 개요

<b>CSS(Cascading Style Sheets)</b>는 HTML로 작성된 문서의 표현(presentation)을 기술하기 위한 스타일 시트 언어다. 웹 페이지의 레이아웃, 색상, 글꼴 등 시각적인 부분을 담당한다.

이름에 포함된 <b>캐스케이딩(Cascading)</b>은 '폭포처럼 쏟아지는'이라는 의미를 가지는데, 이는 상위 요소의 스타일 속성이 자식 요소에게 상속되는 특징을 비유한 것이다. 이 상속의 원리와 여러 스타일 규칙이 충돌할 때 어떤 것을 적용할지 결정하는 <b>우선순위(Specificity)</b>를 이해하는 것이 CSS 학습의 핵심이라고 할 수 있다.

이 문서는 CSS의 기본 문법부터 선택자, 우선순위 규칙, 그리고 현대적인 레이아웃 기법인 Flexbox까지 핵심적인 개념들을 체계적으로 정리하는 것을 목표로 한다.

## 2. CSS 기본 문법

CSS의 규칙은 <b>선택자(Selector)</b>와 <b>선언 블록(Declaration Block)</b>으로 구성된다. 선언 블록 안에는 하나 이상의 <b>선언(Declaration)</b>이 포함되며, 각 선언은 <b>속성(Property)</b>과 <b>값(Value)</b>의 쌍으로 이루어진다.

```css
/* h1 태그를 선택하여 스타일을 적용 */
h1 {
  color: blue; /* 속성: 값; */
  font-size: 16px;
}
```

-   <b>선택자(Selector)</b>: 스타일을 적용할 HTML 요소를 지정한다. (`h1`)
-   <b>선언 블록(Declaration Block)</b>: 중괄호 `{}`로 묶인 영역으로, 하나 이상의 스타일 선언을 포함한다.
-   <b>선언(Declaration)</b>: 속성과 값을 한 쌍으로 묶은 것이며, 세미콜론`;`으로 끝난다. (`color: blue;`)

## 3. 선택자(Selector)의 종류

선택자는 특정 요소를 얼마나 정확하게 가리키는지에 따라 다양하게 나뉜다.

-   <b>전체 선택자(Universal Selector)</b>: `*` (모든 요소를 선택)
-   <b>타입 선택자(Type Selector)</b>: `div`, `p`, `h1` (태그 이름으로 선택)
-   <b>ID 선택자(ID Selector)</b>: `#header` (id 속성값으로 선택, 문서 내에서 유일해야 함)
-   <b>클래스 선택자(Class Selector)</b>: `.item`, `.container` (class 속성값으로 선택, 여러 요소에 중복 적용 가능)
-   <b>상태 선택자(State Selector)</b>: `:hover`, `:focus` (사용자의 특정 행동에 따른 상태를 선택)
-   <b>속성 선택자(Attribute Selector)</b>: `[type="text"]` (속성 유무나 속성값으로 선택)

## 4. CSS 적용 우선순위

하나의 요소에 여러 스타일 규칙이 동시에 적용될 때, 어떤 규칙을 최종적으로 적용할지 결정하는 기준이 필요하다. 이 기준은 아래 3가지 원칙에 따라 결정된다.

### 4-1. 중요도(Importance)와 출처
스타일이 어디서 선언되었는지에 따라 우선순위가 정해진다. 사용자 스타일 시트의 `!important`가 가장 강력하다.

> 사용자 `!important` 스타일 > 개발자 `!important` 스타일 > 개발자 스타일 > 사용자 스타일 > 브라우저 기본 스타일

> [!IMPORTANT]
> `!important` 규칙은 다른 모든 우선순위 규칙을 무시하므로, 유지보수를 어렵게 만든다. 꼭 필요한 경우가 아니라면 사용을 지양하는 것이 좋다.

### 4-2. 명시도(Specificity)
선택자가 얼마나 구체적으로 요소를 특정하는지를 점수화하여 우선순위를 계산한다. 점수가 높을수록 우선순위가 높다.

> 인라인 스타일 > ID 선택자 > 클래스/상태/속성 선택자 > 타입 선택자 > 전체 선택자

-   <b>인라인 스타일(Inline Style)</b>: `<div style="color: red;">` 와 같이 HTML 태그에 직접 작성
-   <b>ID 선택자</b>: `#my-id`
-   <b>클래스, 상태, 속성 선택자</b>: `.my-class`, `:hover`, `[type="text"]`
-   <b>타입 선택자</b>: `div`, `p`

### 4-3. 소스 순서(Source Order)
위의 중요도와 명시도 점수가 모두 같다면, 소스 코드에서 <b>가장 나중에 선언된 규칙</b>이 이전에 선언된 규칙을 덮어쓴다.

## 5. 박스 모델(Box Model)

모든 HTML 요소는 사각형의 박스 형태로 렌더링되며, 이 박스는 4개의 영역으로 구성된다.

-   <b>콘텐츠(Content)</b>: 텍스트나 이미지가 표시되는 실제 내용 영역
-   <b>패딩(Padding)</b>: 콘텐츠와 테두리 사이의 내부 여백
-   <b>테두리(Border)</b>: 패딩과 마진 사이를 감싸는 선
-   <b>마진(Margin)</b>: 테두리 바깥의 외부 여백으로, 다른 요소와의 간격을 조정하는 데 사용된다.

## 6. Flexbox 레이아웃

<b>Flexbox</b>는 복잡한 웹 페이지 레이아웃을 쉽고 유연하게 구성할 수 있도록 설계된 1차원 레이아웃 모델이다. 기존의 `position`, `float` 등을 사용하던 방식보다 훨씬 직관적이고 강력한 기능을 제공한다.

Flexbox는 <b>컨테이너(Container)</b>와 그 안의 <b>아이템(Item)</b>이라는 두 가지 개념으로 동작하며, 중심축(Main Axis)과 교차축(Cross Axis)이라는 두 개의 축을 기준으로 아이템을 정렬한다.

### 6-1. Flex Container 속성 (부모 요소에 적용)

-   `display: flex;`: 해당 요소를 Flexbox 컨테이너로 만든다.
-   `flex-direction`: 아이템이 정렬될 중심축의 방향을 결정한다. (`row`, `column` 등)
-   `justify-content`: 중심축 방향으로 아이템을 정렬하는 방법을 결정한다. (`flex-start`, `center`, `space-between` 등)
-   `align-items`: 교차축 방향으로 아이템을 정렬하는 방법을 결정한다. (`stretch`, `center`, `flex-start` 등)
-   `flex-wrap`: 아이템이 한 줄에 다 들어가지 않을 때 줄바꿈 여부를 결정한다. (`nowrap`, `wrap`)

### 6-2. Flex Item 속성 (자식 요소에 적용)

-   `order`: 아이템의 시각적 순서를 변경한다. (숫자가 작을수록 앞에 배치)
-   `align-self`: 특정 아이템에 대해서만 교차축 정렬을 개별적으로 변경한다.
-   `flex-grow`: 아이템이 컨테이너의 여백을 차지하며 늘어날 비율을 지정한다.
-   `flex-shrink`: 컨테이너 공간이 부족할 때 아이템이 줄어들 비율을 지정한다.

## 7. 참고 자료

-   <b>Flexbox Froggy</b>: Flexbox 속성을 게임을 통해 재미있게 학습할 수 있는 사이트
    -   [https://flexboxfroggy.com/#ko](https://flexboxfroggy.com/#ko)
-   <b>A Complete Guide to Flexbox</b>: Flexbox의 모든 속성을 시각 자료와 함께 상세히 설명하는 가이드
    -   [https://css-tricks.com/snippets/css/a-guide-to-flexbox/](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)
-   <b>Can I use...</b>: 특정 CSS 속성의 브라우저별 호환성 정보를 확인할 수 있는 사이트
    -   [https://caniuse.com/](https://caniuse.com/)
