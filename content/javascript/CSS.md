---
title: CSS
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
Cascading Style Sheet

cascade - steep waterfall, 상위 요소의 스타일 속성을 자손 요소들에게 상속시켜주는 모습이 마치 폭포수가 내려가는 모습을 닮았다 하여 붙여진 이름.

```CSS
selector {
	/* Style would go here. */
}
```

  

## Selectors

```CSS
* /* Universal */

type Tag

ID \#id

Class .class

State :

Attribute []
```

flex box

  

# CSS 적용 우선순위

### 중요도(Importance)

- 스타일이 어디서 선언되었는가에 따라 우선순위가 달라짐

> User style(important) > Author style(important) > Author style > User style > Browser style

  

  

### 적용범위(Specificity)

- 스타일의 적용 범위에 따라 우선순위가 달라짐

> !important exception > inline-style > \#id selector > .class & :pseudo-class selector > element selector

  

  

### Source Order

- 중요도와 적용범위가 같을 경우 소스에서 나중에 온 스타일이 기존 스타일을 덮어씌움

  

  

### !important

- 연결고리 무시
- 가능하면 사용하지 않는 것이 좋다

  

# 자주 쓰이는 속성들

## 텍스트 관련

## 배경 & 칼라

# 박스 레이아웃

  

# Flex Box

CSS의 꽃, 박스안에서 유연하게 배치할 수 있는 것

position, table, float를 대체하는 기능

float 이미지와 텍스트를 배치하기 위한 기능

container, item

  

flex-direction

justify-content,

align-items

order

align-self

flex-wrap

flex-flow(flex-direction + flex-wrap)

  

  

중심축과 반대축

main axis

cross axis

  

# 반응형 웹

  

  

  

margin border padding element

  

  

padding margin

  

display position stack

  

아이템 위치 변경

기본적으로 position이 static으로 구성, relative, absolute, fixed, sticky로 바꾸면 변경 가능

  

브라우저 호환성 여부 검사 필수

  

  

  

## References

---

- CSS 게임

[https://flukeout.github.io](https://flukeout.github.io/)

- 브라우저 호환성 확인

[https://caniuse.com/](https://caniuse.com/)

- flexbox 가이드

[https://css-tricks.com/snippets/css/a-guide-to-flexbox/](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)

- flex box game

[https://flexboxfroggy.com/#ko](https://flexboxfroggy.com/#ko)