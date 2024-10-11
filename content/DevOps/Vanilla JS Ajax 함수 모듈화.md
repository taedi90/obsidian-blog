---
title: Vanilla JS Ajax 함수 모듈화
date: 2021-12-05
draft: false
tags:
  - javascript
banner: 
cssclasses: 
description: 바닐라 자바스크립트 Ajax 함수 모듈화
permalink: 
aliases: 
completed:
---
개인 프로젝트나 팀 프로젝트 할 것 없이 Ajax 를 매우 많은 곳에 사용했는데 그때마다 코드를 작성하려니 `contentType` 같이 외우기 까다로운 부분도 있고 코드도 길어진다고 판단하여 모듈화를 하여 사용하였다.

개인적으로 `post` 방식으로 `json` 데이터를 사용하는 경우가 많아서 기본값으로 두었고, 데이터는 "`json / multipart / urlencoded`" 에 대한 부분만 고려했다.

코드는 짧지만 깔끔해 보이지 않아서 한참이나 고민했지만 결국 만족할 만큼 다듬지 못한 것 같다.

# 시도해본 것

- 필요한 전달인자만 입력하면 되도록

# 코드

```javascript
'use strict';

/**
 * Vanilla JavaScript Ajax 함수 모듈화
 *
 * @param {string} url - (required) 호출 할 url
 * @param {object} data - (optional) 전송 할 데이터
 * @param {function} confirmCallback - (optional) ajax 통신 완료 후 실행 할 함수
 * @param {function} cancelCallback -  (optional) ajax 통신 실패 시 실행 할 함수
 * @param {string} method -  (optional) post / get / put ...
 * @param {string} contentType -  (optional) json / multipart / urlencoded
 *
 * @example
 * ajax('board/insert',{method: "get"})
 *
 * @author taedi <taedi90@gmail.com>
 */

function ajax(url = '',
              {
                  data = {},
                  callback = (res) => console.log(res),
                  errorCallback = (res) => console.error(res),
                  method = 'post',
                  contentType = 'json'
              } = {}) {

    if(contentType == "json") {
        contentType = "application/json; charset=utf-8";
        data = JSON.stringify(data);
    } else if (contentType == "multipart") {
        //do nothing
    } else {
        contentType = "application/x-www-form-urlencoded; charset=utf-8;";
        url = url + "?" + new URLSearchParams(Object.entries(data)).toString();
        data = null;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    if(contentType != "multipart"){
        xhr.setRequestHeader('Content-Type', contentType);
    }
    xhr.send(data);

    xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 201) { // 통신 성공 시
            callback(xhr.response);
        } else { // 통신 실패 시
            errorCallback(xhr.status);
        }
    }

}
```