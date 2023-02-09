(function () {
  "use strict";

  angular
    .module('umbraco')
    .component('umbIdLoginButton', {
      templateUrl: '../App_Plugins/UmbracoId/BackOffice/umbidlogin.component.html',
      controller: UmbIdLoginButton,
      controllerAs: 'vm',
      require: {
        umbLogin: '^umbLogin'
      },
      bindings: {
        login: "<",
        errors: "<"
      }
    });

  function UmbIdLoginButton($scope, $location, userService, $cookies, $window) {

    const vm = this;

    const popupHeight = 600;
    const popupWidth = 800;

    vm.$onInit = onInit;
    vm.$onChanges = onChanges;
    vm.submitLoginForm = submitLoginForm;
    vm.navigateToLoginForm = navigateToLoginForm;
    vm.popupError = false;
    const backOfficeUrl = getBackOfficeUrl();

    function onInit() {
      // This is a v9 compatibility hack
      if (!vm.login.properties.SocialStyle) {
        vm.login.properties.SocialStyle = vm.login.properties.ButtonStyle;
      }
      if (!vm.login.properties.SocialIcon) {
        vm.login.properties.SocialIcon = vm.login.properties.Icon;
      }
    }

    function onChanges(changes) {
      if (changes.errors) {
        if (changes.errors.currentValue && changes.errors.currentValue.length > 0) {
          if ($window.opener) {
            // If there are errors and we're in a popup window, then message the opener about the errors so it can deal with them.
            var targetWindow = $window.opener;
            // send the message to the popup opener
            targetWindow.postMessage({
              externalLoginErrors: changes.errors.currentValue
            }, targetWindow.location.origin);
          }
        }
      }
    }

    function getBackOfficeUrl() {
      let backOfficeUrl = $location.absUrl();
      let hash = backOfficeUrl.indexOf("#");
      if (hash > 0) {
        backOfficeUrl = backOfficeUrl.substr(0, hash);
      }
      return backOfficeUrl.trimEnd("/").toLowerCase();
    }

    function navigateToLoginForm(e) {
      e.target.submit();
    }

    function submitLoginForm(e) {

      // we need to build the URL manually because we cannot use server vars since we are logged out.
      // I would rather not hard code this but we don't have much choice apart from hacking the planet elsewhere.
      var endpoint = backOfficeUrl + "/backoffice/UmbracoIdChallenge/Login";

      e.preventDefault();

      //create new oAuth popup window and monitor it
      oauthpopup({
        path: endpoint,
        callback: function (args) {

          //check if there's a returnPath query string, if so redirect to it
          //var path = "/";                    
          //var locationObj = $location.search();
          //if (locationObj.returnPath) {
          //    path = decodeURIComponent(locationObj.returnPath);
          //}

          userService.setAuthenticationSuccessful(args.userData);

          // Call the umbLogin component method to handle successful login
          vm.umbLogin.loginSuccess();

          // TODO: Not sure we need this at all with the above
          //if (vm.state !== "backoffice") {
          //    $location.url(path);
          //}

          $scope.$evalAsync();
        }
      });
    }

    function isBackOfficeUrl(url) {
      if (!url) return false;
      let path = url.split("?")[0]
      path = path.split("#")[0];
      path = path.trimEnd("/").toLowerCase();
      return path === backOfficeUrl;
    }

    function hasXsrfCookie() {
      return $cookies.get("UMB-XSRF-TOKEN");
    }

    //Authorization popup window code
    function oauthpopup(options) {
      options.windowName = options.windowName || 'ConnectWithOAuth'; // should not include space for IE
      options.windowOptions = options.windowOptions || 'location=0,status=0,width=' + popupWidth + ',height=' + popupHeight;
      options.callback = options.callback || function () { window.location.reload(); };

      let oauthWindow = window.open(options.path, options.windowName, options.windowOptions);

      if (!oauthWindow || oauthWindow.closed || typeof oauthWindow.closed == 'undefined') {
        //POPUP BLOCKED
        vm.popupError = true;
      }
      else {
        vm.popupError = false;
        const timeout = 200;
        setTimeout(checkPopup, timeout);
        let checkPopupCount = 0;
        let readyStateBound = false;
        let oauthDocument = null;
        function checkPopup() {
          if (oauthWindow.closed) {
            // if the window was closed by the user....

          }
          else if (isBackOfficeUrl(tryGetOAuthWindowUrl()) && tryConfigureOAuthWindowDocument() && hasXsrfCookie()) {

            userService.getCurrentUser().then(function (userData) {

              // close the window 
              oauthWindow.close();
              options.callback({ userData: userData });

            }, function (err) {

              if (err.status === 401) {
                retryCheckPopup();
              }
              else if (err.status === 400) {
                // this will happen when strange things occur like the auth has half taken place and now there's a giant cookie
                // that cannot be dealt with. In this case, I'm unsure what to do because all web requests will now fail.
              }
              else {
                // This can happen with a -1 status which can mean a ysod occurred in the popup and the user closed it
                // ... at least that's what I've discovered
              }
            });
          }
          else {
            retryCheckPopup();
          }
        }
        function hideEverything() {
          const body = oauthDocument.getElementsByTagName("body")[0];
          const rootLevelElements = body.children;
          for (let i = 0; i < rootLevelElements.length; i++) {
            rootLevelElements[i].style.display = 'none';
          }
          // show custom message
          const pleaseWait = oauthDocument.createElement("h4");
          pleaseWait.style.margin = "20px";
          pleaseWait.appendChild(document.createTextNode("Logged in with Umbraco Id... please wait... "));
          body.appendChild(pleaseWait);
        }
        function tryGetOAuthWindowUrl() {
          try {
            return oauthWindow.location.href;
          } catch (e) {
            return null;
          }
        }
        function tryConfigureOAuthWindowDocument() {
          if (oauthDocument) {
            return true;
          }
          // try to get the document, this will throw if it's not the same domain which we've 
          // already checked for but need to be sure
          try {
            oauthDocument = oauthWindow.document;
          } catch (e) {
            return false;
          }

          // Add event listener for if the popup window sends us a message, this will occur
          // when there are oath errors that we should deal with.
          $window.addEventListener("message", (event) => {

            if (event.origin !== $window.location.origin) {
              return;
            }
            if (!event.data.externalLoginErrors) {
              return;
            }

            // we have errors, so we can assign these errors to ourself and close the window

            vm.errors = event.data.externalLoginErrors;
            oauthWindow.close();
            $scope.$evalAsync();

          }, false);

          // if we get the document object then bind to events/state 
          // so we can hide elements and show a custom message
          if (oauthDocument) {
            if (oauthDocument.readyState === 'complete') {
              hideEverything();
            }
            else if (!readyStateBound) {
              readyStateBound = true;
              oauthDocument.addEventListener('readystatechange', event => {
                if (event.target.readyState !== 'loading') {
                  hideEverything();
                }
              });
            }
            return true;
          }

          return false;
        }
        function retryCheckPopup() {

          // 1500 tries will be approx 5 minutes which is plenty of time
          // (1500 x 200ms = 300000ms = 5 min)
          if (checkPopupCount > 1500) {
            vm.errors = ["Umbraco ID authentication has timed out"];
            oauthWindow.close();
            $scope.$evalAsync();
            return;
          }

          checkPopupCount++;
          // this would be a normal response that they are not logged in yet, so repeat
          setTimeout(checkPopup, timeout);
        }
      }
    }



  }


})();
